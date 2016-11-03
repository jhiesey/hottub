const PIN_MUX_X = 18
const PIN_MUX_Y = 23

// x=0, y=0: temp
// x=0, y=1: pH
// x=1, y=0: orp

const SENSORS = {
	TEMP: {x:0,y:0},
	PH: {x:0,y:1},
	ORP: {x:1,y:0}
}

const EventEmitter = require('events')
const fs = require('fs')
const async = require('async')
const SerialPort = require('serialport')
const Pins = require('./pins')

const RESPONSE_TIMEOUT = 1000 // ms
const READING_TIMEOUT = 2000 // ms

class Sensors extends EventEmitter {
	constructor () {
		super()
		var self = this

		self.temp = null
		self.ph = null
		self.orp = null
		self.enabled = false
		self._ready = false
		self._running = false
		self._pins = Pins({
			PIN_MUX_X: { in: false },
			PIN_MUX_Y: { in: false }
		})

		self._uart = new SerialPort('/dev/ttyAMA0', {
			baudRate: 9600,
			parser: SerialPort.parsers.readline('\r')
		})
		self._lines = []
		self._lineCbs = []

		self._uart.on('open', function () {
			self._ready = true
			self._loop();
		})

		self._uart.on('data', function (data) {
			if (self._lineCbs.length) {
				self._lineCbs.shift()(null, data)
			} else {
				self._lines.push(data)
			}
		})

		self._uart.on('error', function (err) {
			self._lineCbs.forEach(function (cb) {
				cb(err)
			})
			self._lines = []
			self._lineCbs = []
		})
	}

	enable(on) {
		var self = this

		self.enabled = !!on
		self._loop()
	}

	_loop(err) {
		var self = this

		if (err) {
			self.emit('error', err)
		}
		if (!self.enabled || self._running || !self._ready)
			return

		self._running = true
		var temp
		var ph
		async.series([
			function (cb) {
				readTemperature(function (err, temp) {
					if (err)
						return cb(err)
					self.temp = temp
					cb()
				})
			},
			function (cb) {
				readPH(self.temp, function (err, ph) {
					if (err)
						return cb(err)
					self.ph = ph
					cb()
				})
			},
			function (cb) {
				readORP(function (err, orp) {
					if (err)
						return cb(err)
					self.orp = orp
					if (self.enabled) {
						self.emit('reading', {
							temp: self.temp,
							ph: self.ph,
							orp: self.orp
						})
					}

					cb()
				})
			}
		], function (err) {
			self._running = false
			self._loop(err)
		})
	}

	_clearBuffer(cb) {
		var self = this

		self._lines = []
		self._lineCbs = []
		self._uart.flush(cb)
	}

	_readLine(timeout, cb) {
		var self = this

		if (self._lines.length)
			return cb(null, self._lines.shift())

		setTimeout(function () {
			if (cb)
				cb(new Error('timed out'))
			cb = null
		}, timeout)
		self._lineCbs.push(function (err, line) {
			if (cb)
				cb(err, line)
			cb = null
		})
	}

	_selectSensor(sensor, cb) {
		var self = this

		async.parallel([
			function (cb) {
				self._pins.set(PIN_MUX_X, SENSORS[sensor].x, cb),
			},
			function (cb) {
				self._pins.set(PIN_MUX_Y, SENSORS[sensor].y, cb)
			}
		], cb)
	}

	_readSensor(sensor, cb) {
		var self = this

		var reading
		async.series([
			function (cb) {
				if (sensor)
					selectSensor(sensor, cb)
				else
					cb()
			},
			self._clearBuffer.bind(self),
			function (cb) {
				self._uart.write('R\r', cb)
			},
			function (cb) {
				self._readLine(READING_TIMEOUT, function (err, line) {
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
				self._readLine(RESPONSE_TIMEOUT, function (err, line) {
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

	_readTemperature(cb) {
		var self = this
		self._readSensor('TEMP', cb)
	}

	_readPH(temp, cb) {
		var self = this

		async.series([
			function (cb) {
				selectSensor('PH', cb)
			},
			self._clearBuffer.bind(self),
			function (cb) {
				self._uart.write('T,' + temp.toString() + '\r', cb)
			},
			function (cb) {
				self._readLine(RESPONSE_TIMEOUT, function (err, line) {
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

	_readORP(cb) {
		var self = this
		self._readSensor('ORP', cb)
	}
}

module.exports = Sensors
