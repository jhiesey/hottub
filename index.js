const Sensors = require('./sensors')
const Pins = require('./pins')
const fs = require('fs')

// PINS
const PIN_CIRCULATION_PUMP = 24
const PIN_CHLORINE_PUMP = 25
const PIN_ACID_PUMP = 11
const PIN_BICARB_PUMP = 9

const PIN_ERROR_IN = 8
const PIN_FLOW_IN = 7

// BASIC TIMING
const CIRCULATION_TIME = 3600 // seconds; 1 hour
const READING_CIRCULATION_TIME = 30 // seconds
const SENSOR_READING_DELAY = 40 // seconds
const SENSOR_READING_TIME = 30 // seconds
const CHECK_INTERVAL = 10 * 60 // seconds
const POWER_ON_DELAY = 60 * 60 // seconds
const POST_ADJUSTMENT_DELAY = 15 * 60 // seconds

// SANITY PARAMETERS
const PH_HARD_MIN = 5.8
const PH_HARD_MAX = 9.2
const ORP_HARD_MIN = 100
const ORP_HARD_MAX = 900

// ADJUSTMENT FACTORS
const PH_MAX = 7.6
const ACID_SECONDS_PER_UNIT = 35
const ACID_GAIN = 0.8
const ACID_EXTRA_UNITS = 0.15
const ACID_MAX_SECONDS = 20

const ORP_MIN = 710
const CHLORINE_SECONDS_PER_MV = 0.8
const ORP_GAIN = 1.8
const CHLORINE_EXTRA_MV = 10
const CHLORINE_MAX_SECONDS = 55

// dissove 70g/l sodium bicarbonate in water; roughly 10g/min
// measure ratio of ph change to expected ph change
// if the change in ph is more than this times the expected, add bicarb for buffering
const MAX_DELTA_PH_RATIO = 1.2
const PH_MIN = 7.3
const BICARBONATE_SECONDS = 55

var status = null

const sensors = new Sensors()
var lastReading = null
var accurateTime = null
var sensorsAccurate = false
sensors.on('reading', function (reading) {
	lastReading = reading

	pins.get(PIN_FLOW_IN, function (err, value) {
		if (err) {
			setError('failed to verify flow')
			return
		}
		// ensure flow is good for SENSOR_READING_DELAY
		var now = new Date()
		if (value) {
			if (accurateTime === null) {
				accurateTime = now.getTime() + SENSOR_READING_DELAY * 1000
			} else {
				if (accurateTime <= now.getTime()) {
					sensorsAccurate = true
				}
			}
		} else {
			accurateTime = null
			sensorsAccurate = false
		}

		if (!sensorsAccurate)
			return

		var line = [now.toLocaleDateString(), now.toLocaleTimeString(), reading.temp, reading.ph, reading.orp].join(',') + '\n'
		fs.appendFile('log/readings.csv', line, function (err) {
			if (err)
				setError('failed log reading: ' + err)
		})

	})
})

var pinDefs = {}
pinDefs[PIN_CIRCULATION_PUMP] = { in: false }
pinDefs[PIN_CHLORINE_PUMP] = { in: false }
pinDefs[PIN_ACID_PUMP] = { in: false }
pinDefs[PIN_BICARB_PUMP] = { in: false }
pinDefs[PIN_FLOW_IN] = { in: true, edge: 'falling' }
pinDefs[PIN_ERROR_IN] = { in: true, edge: 'rising' }
var pins = new Pins(pinDefs)
pins.on('ready', function () {
	checkErrorPin()
	circulate(POWER_ON_DELAY + SENSOR_READING_DELAY)
	setTimeout(checkAndAdjust, POWER_ON_DELAY * 1000)
	startServer()
})
var onFlowStop = null
pins.on('edge', function (pin, value) {
	if (value && pin === PIN_ERROR_IN) {
		checkErrorPin()
	} else if (!value && pin === PIN_FLOW_IN) {
		sensorsAccurate = false
		accurateTime = null
		if (onFlowStop)
			onFlowStop()
	}
})

function checkErrorPin () {
	pins.get(PIN_ERROR_IN, function (err, value) {
		if (err) {
			setError('failed to check for error: ' + err)
			return
		}
		if (value) {
			setError('failsafe error!')
		}
	})
}

function setError (message) {
	console.error(message)
	status = status || message
}

// For measuring the expected vs. actual ph change
var acidStart = null
var acidPhDeltaGoal = null

var adjusting = false
function checkAndAdjust () {
	if (adjusting || status)
		return

	adjusting = true
	getAccurateReading(function (err, reading) {
		var duration = 0
		var pump
		var delay = CHECK_INTERVAL
		if (err) {
			setError('failed to read: ' + err)
		} else if (!reading) {
			console.error('timed out waiting for flow')
		} else if (reading.ph < PH_HARD_MIN || reading.ph > PH_HARD_MAX || reading.orp < ORP_HARD_MIN || reading.orp > ORP_HARD_MAX) {
			setError('reading out of range!')
		} else if (reading.ph < PH_MIN || (acidStart !== null && (acidStart - reading.ph) > MAX_DELTA_PH_RATIO * acidPhDeltaGoal)) {
			acidStart = null
			acidPhDeltaGoal = null
			pump = 'bicarbonate'
			duration = BICARBONATE_SECONDS
			delay = POST_ADJUSTMENT_DELAY
		} else if (reading.ph > PH_MAX) {
			pump = 'acid'
			duration = Math.min(((reading.ph - PH_MAX) * ACID_GAIN + ACID_EXTRA_UNITS) * ACID_SECONDS_PER_UNIT, ACID_MAX_SECONDS)
			acidStart = reading.ph
			acidPhDeltaGoal = duration / ACID_SECONDS_PER_UNIT
			delay = POST_ADJUSTMENT_DELAY
		} else if (reading.orp < ORP_MIN) {
			pump = 'chlorine'
			duration = Math.min(((ORP_MIN - reading.orp) * ORP_GAIN + CHLORINE_EXTRA_MV) * CHLORINE_SECONDS_PER_MV, CHLORINE_MAX_SECONDS)
			delay = POST_ADJUSTMENT_DELAY
		}

		if (duration > 0) {
			console.log('RUNNING PUMP:', pump, 'FOR DURATION:', duration)
			runPump(pump, duration)
		}

		adjusting = false
		setTimeout(checkAndAdjust, delay * 1000)
	})
}

function getAccurateReading(cb) {
	circulate(2 * SENSOR_READING_DELAY + SENSOR_READING_TIME)

	function finished (err, reading) {
		sensors.removeListener('reading', onReading)
		if (cb) {
			var callback = cb
			cb = null
			callback(err, reading)
		}
	}

	function onReading (reading) {
		if (sensorsAccurate) {
			finished(null, reading)
		}
	}
	sensors.on('reading', onReading)
	setTimeout(function () {
		finished(null, null)
	}, 2 * SENSOR_READING_DELAY * 1000) // give longer delay in case of intermittent flow
}

var circulationEnd = 0 // ms since epoch
var circulationTimer = 0
var sensorsAccurate = false
// ensures the circulation pump will run for at least duration seconds
function circulate (duration) {
	// if not running
	if (circulationEnd === 0) {
		pins.set(PIN_CIRCULATION_PUMP, true, function (err) {
			if (err)
				setError('failed to start pump: ' + err)
		})
		sensors.enable(true)
	}

	const end = Date.now() + duration * 1000
	if (end > circulationEnd) {
		clearTimeout(circulationTimer)
		circulationEnd = end
		circulationTimer = setTimeout(function () {
			circulationEnd = 0
			pins.set(PIN_CIRCULATION_PUMP, false, function (err) {
				if (err)
					setError('failed to stop pump: ' + err)
			})
			sensors.enable(false)
			accurateTime = null
			sensorsAccurate = false
		}, duration * 1000)
	}
}

function runPump (pump, duration) {
	var pumpPin
	switch (pump) {
		case 'chlorine':
			pumpPin = PIN_CHLORINE_PUMP
			break
		case 'acid':
			pumpPin = PIN_ACID_PUMP
			break
		case 'bicarbonate':
			pumpPin = PIN_BICARB_PUMP
			break
		default:
			throw new Error('invalid pump specified')
	}
	var now = new Date()
	var line = [now.toLocaleDateString(), now.toLocaleTimeString(), pump, duration].join(',') + '\n'
	fs.appendFile('log/adjustments.csv', line, function (err) {
		if (err)
			setError('failed to log adjustment: ' + err)
	})

	circulate(duration + CIRCULATION_TIME)

	function stopPump() {
		onFlowStop = null
		pins.set(pumpPin, false, function (err) {
				if (err)
					setError('failed to stop pump: ' + err)
		})
	}

	if (onFlowStop) {
		setError('tried to run two chemical pumps at once!')
		return
	}
	onFlowStop = function () {
		stopPump()
		console.error('flow stopped during chemical pumping!')
	}
	if (sensorsAccurate) { // verifies circulation
		pins.set(pumpPin, true, function (err) {
			if (err)
				setError('failed to start pump: ' + err)

			setTimeout(stopPump, duration * 1000)
		})
	} else {
		console.error('flow stopped before chemical pumping!')
		return
	}
}

const http = require('http')
const pug = require('pug')
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')

var app = express()
var httpServer = http.createServer(app)
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')
app.set('x-powered-by', false)
app.engine('pug', pug.renderFile)

app.use(express.static(path.join(__dirname, 'static')))
app.use(bodyParser.json())

app.get('/', function (req, res, next) {
	res.render('index', {
		title: 'Hot Tub Status',
		temp: lastReading ? lastReading.temp : '?',
		ph: lastReading ? lastReading.ph : '?',
		orp: lastReading ? lastReading.orp : '?',
		status: status || 'ok'
	})
})

// returns once reading done
app.get('/reading', function (req, res, next) {
	circulate(READING_CIRCULATION_TIME)

	// blocks until the next reading
	sensors.once('reading', function (reading) {
		res.setHeader('Content-Type', 'application/json')

		const fullReading = {
			temp: reading.temp,
			ph: reading.ph,
			orp: reading.orp,
			accurate: sensorsAccurate,
			status: status || 'ok'
		}
		res.send(JSON.stringify(fullReading))
	})
})

app.get('*', function (req, res) {
  res.status(404).render('error', {
    title: '404 Page Not Found - hottub.local',
    message: '404 Not Found'
  })
})

// error handling middleware
app.use(function (err, req, res, next) {
  error(err)
  res.status(500).render('error', {
    title: '500 Server Error - hottub.local',
    message: err.message || err
  })
})

function startServer() {
	httpServer.listen(80)
}

function error (err) {
  console.error(err.stack || err.message || err)
}
