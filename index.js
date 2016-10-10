var PIN_MUX_X = 18
var PIN_MUX_Y = 23

// x=0, y=0: temp
// x=0, y=1: pH
// x=1, y=0: orp

var SENSORS = {
	TEMP: {x:0,y:0},
	PH: {x:0,y:1},
	ORP: {x:1,y:0}
}

var PIN_CIRCULATION_PUMP = 24
var PIN_CHLORINE_PUMP = 25
var PIN_ACID_PUMP = 8

var fs = require('fs')
var async = require('async')
var SerialPort = require('serialport')

var RESPONSE_TIMEOUT = 1000 // ms
var READING_TIMEOUT = 2000 // ms

function setupPins(cb) {
	async.parallel([
		PIN_MUX_X,
		PIN_MUX_Y,
		PIN_CIRCULATION_PUMP,
		PIN_CHLORINE_PUMP,
		PIN_ACID_PUMP
	].map(function (pin) {
		return function (cb) {
			async.series([
				function (cb) {
					fs.access('/sys/class/gpio/gpio' + pin, function (err) {
						if (err)
							fs.writeFile('/sys/class/gpio/export', pin.toString(), cb)
						else
							cb()
					})
				},
				function (cb) {
					fs.writeFile('/sys/class/gpio/gpio' + pin + '/direction', 'out', cb)
				},
				function (cb) {
					fs.writeFile('/sys/class/gpio/gpio' + pin + '/edge', 'none', cb)
				},
				function (cb) {
					fs.writeFile('/sys/class/gpio/gpio' + pin + '/value', '0', cb)
				}
			], cb)
			//gpio.setup(pin, gpio.DIR_OUT, gpio.EDGE_NONE, cb)
		}
	}), cb)
}

var uart = new SerialPort('/dev/ttyAMA0', {
	baudRate: 9600,
	parser: SerialPort.parsers.readline('\r')
})
var lines = []
var lineCbs = []

uart.on('data', function (data) {
	if (lineCbs.length) {
		lineCbs.shift()(null, data)
	} else {
		lines.push(data)
	}
})

uart.on('error', function (err) {
	lineCbs.forEach(function (cb) {
		cb(err)
	})
	lines = []
	lineCbs = []
})

function clearBuffer (cb) {
	lines = []
	lineCbs = []
	uart.flush(cb)
}

function readLine(timeout, cb) {
	if (lines.length)
		return cb(null, lines.shift())

	setTimeout(function () {
		if (cb)
			cb(new Error('timed out'))
		cb = null
	}, timeout)
	lineCbs.push(function (err, line) {
		if (cb)
			cb(err, line)
		cb = null
	})
}

function selectSensor(sensor, cb) {
	async.parallel([
		function (cb) {
			fs.writeFile('/sys/class/gpio/gpio' + PIN_MUX_X + '/value', SENSORS[sensor].x ? '1' : '0', cb)
		},
		function (cb) {
			fs.writeFile('/sys/class/gpio/gpio' + PIN_MUX_Y + '/value', SENSORS[sensor].y ? '1' : '0', cb)
		}
	], cb)
}

function readSensor(sensor, cb) {
	var reading
	async.series([
		function (cb) {
			if (sensor)
				selectSensor(sensor, cb)
			else
				cb()
		},
		clearBuffer,
		function (cb) {
			uart.write('R\r', cb)
		},
		function (cb) {
			readLine(READING_TIMEOUT, function (err, line) {
				if (err)
					return cb(err)
				if (line.length === 0) {
					return cb(new Error('Bad reading'))
				}
				reading = parseFloat(line)
				cb()
			})
		},
		function (cb) {
			readLine(RESPONSE_TIMEOUT, function (err, line) {
				if (err)
					return cb(err)
				if (line !== '*OK') {
					return cb(new Error('Bad response line'))
				}
				cb()
			})
		}
	], function (err) {
		if (err)
			return cb(err)
		cb(null, reading)
	})
}

function readTemperature(cb) {
	readSensor('TEMP', cb)
}

function readPH(temp, cb) {
	async.series([
		function (cb) {
			selectSensor('PH', cb)
		},
		clearBuffer,
		function (cb) {
			uart.write('T,' + temp.toString() + '\r', cb)
		},
		function (cb) {
			readLine(RESPONSE_TIMEOUT, function (err, line) {
				if (err)
					return cb(err)
				if (line !== '*OK')
					return cb(new Error('Bad response line'))
				cb()
			})
		}, function (cb) {
			readSensor(null, cb)
		}
	], function (err, data) {
		if (err)
			return cb(err)
		cb(null, data[data.length - 1])
	})
}

function readORP(cb) {
	readSensor('ORP', cb)
}

uart.on('open', function () {
	setupPins(loop)
})

var storedTemp
function loop(err) {
	if (err) return
	async.series([
		function (cb) {
			readTemperature(function (err, temp) {
				if (err)
					return cb(err)
				storedTemp = temp
				console.log('TEMP:', temp)
				cb()
			})
		},
		function (cb) {
			readPH(storedTemp, function (err, ph) {
				if (err)
					return cb(err)
				console.log('PH:', ph)
				cb()
			})
		},
		function (cb) {
			readORP(function (err, orp) {
				if (err)
					return cb(err)
				console.log('ORP:', orp)
				cb()
			})
		}
	], loop)
}
