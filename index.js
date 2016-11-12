const Sensors = require('./sensors')
const Pins = require('./pins')
const fs = require('fs')

// PINS
const PIN_CIRCULATION_PUMP = 24
const PIN_CHLORINE_PUMP = 25
const PIN_ACID_PUMP = 11
const PIN_BASE_PUMP = 9

const PIN_ERROR_IN = 8
const PIN_FLOW_IN = 7

// BASIC TIMING
const CIRCULATION_TIME = 3600 // seconds; 1 hour
const READING_CIRCULATION_TIME = 30 // seconds
const SENSOR_READING_DELAY = 60 // seconds
const SENSOR_READING_TIME = 60 // seconds
const CHECK_INTERVAL = 15 * 60 // seconds

// SANITY PARAMETERS
const PH_HARD_MIN = 5.8
const PH_HARD_MAX = 9.2
const ORP_HARD_MIN = 100
const ORP_HARD_MAX = 900

// ADJUSTMENT FACTORS
const PH_MAX = 7.7
const ACID_SECONDS_PER_UNIT = 50
const ACID_MIN_SECONDS = 5
const ACID_MAX_SECONDS = 30
const ACID_DELAY = 1800

const PH_MIN = 0 // 7.3
const BASE_SECONDS_PER_UNIT = 50 // TODO: establish this
const BASE_MIN_SECONDS = 0 // TODO: establish this
const BASE_MAX_SECONDS = 0 // TODO: establish this
const BASE_DELAY = 1800

const ORP_MIN = 700
const CHLORINE_SECONDS_PER_MV = 0.5
const CHLORINE_MIN_SECONDS = 5
const CHLORINE_MAX_SECONDS = 30
const CHLORINE_DELAY = 3600

var status = null

const sensors = new Sensors()
var lastReading = null
sensors.on('reading', function (reading) {
	lastReading = reading
	if (!sensorsAccurate)
		return

	var line = [new Date().toLocaleString(), reading.temp, reading.ph, reading.orp].join(',') + '\n'
	fs.appendFile('readings.csv', line, function (err) {
		if (err)
			setError('failed log reading: ' + err)
	})
})

var pumpPins = {}
pumpPins[PIN_CIRCULATION_PUMP] = { in: false }
pumpPins[PIN_CHLORINE_PUMP] = { in: false }
pumpPins[PIN_ACID_PUMP] = { in: false }
pumpPins[PIN_BASE_PUMP] = { in: false }

var pumps = new Pins(pumpPins)
pumps.on('ready', function () {
	checkAndAdjust()
	startServer()
})

var inputPins = {}
inputPins[PIN_FLOW_IN] = { in: true }
inputPins[PIN_ERROR_IN] = { in: true, edge: 'rising' }
var inputs = new Pins(inputPins)
function checkErrorPin () {
	inputs.get(PIN_ERROR_IN, function (err, value) {
		if (err) {
			setError('failed to check for error: ' + err)
			return
		}
		if (value) {
			setError('failsafe error!')
		}
	})
}

inputs.on('ready', function () {
	checkErrorPin()
})
inputs.on('edge', function (pin, value) {
	if (value && pin === PIN_ERROR_IN) {
		checkErrorPin()
	}
})

function setError (message) {
	console.error(message)
	status = status || message
}

function between (value, min, max) {
	return Math.min(Math.max(value, min), max)
}

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
		} else if (reading.ph < PH_HARD_MIN || reading.ph > PH_HARD_MAX || reading.orp < ORP_HARD_MIN || reading.orp > ORP_HARD_MAX) {
			setError('reading out of range!')
		} else if (reading.ph > PH_MAX) {
			pump = 'acid'
			duration = between((reading.ph - PH_MAX) * ACID_SECONDS_PER_UNIT, ACID_MIN_SECONDS, ACID_MAX_SECONDS)
			delay = ACID_DELAY
		} else if (reading.ph < PH_MIN) {
			pump = 'base'
			duration = between((PH_MIN - reading.ph) * BASE_SECONDS_PER_UNIT, BASE_MIN_SECONDS, BASE_MAX_SECONDS)
			delay = BASE_DELAY
		} else if (reading.orp < ORP_MIN) {
			pump = 'chlorine'
			duration = between((ORP_MIN - reading.orp) * CHLORINE_SECONDS_PER_MV, CHLORINE_MIN_SECONDS, CHLORINE_MAX_SECONDS)
			delay = CHLORINE_DELAY
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
	circulate(SENSOR_READING_DELAY + SENSOR_READING_TIME)

	function onReading (reading) {
		if (!sensorsAccurate)
			return

		sensors.removeListener('reading', onReading)
		cb(null, reading)
	}
	sensors.on('reading', onReading)
}

var circulationEnd = 0 // ms since epoch
var circulationTimer = 0
var sensorsAccurate = false
// ensures the circulation pump will run for at least duration seconds
function circulate (duration) {
	// if not running
	if (circulationEnd === 0) {
		pumps.set(PIN_CIRCULATION_PUMP, true, function (err) {
			if (err)
				setError('failed to start pump: ' + err)
		})
		sensors.enable(true)
		// set accurate flag after delay
		function checkAccurate () {
			inputs.get(PIN_FLOW_IN, function (err, value) {
				if (err) {
					setError('failed to verify flow')
					return
				}
				if (value) {
					if (circulationEnd !== 0) {
						sensorsAccurate = true
					}
				} else {
					console.error('no flow! retrying after delay...')
					setTimeout(checkAccurate, SENSOR_READING_DELAY * 1000)
				}
			})
		}
		setTimeout(checkAccurate, SENSOR_READING_DELAY * 1000)
	}

	const end = Date.now() + duration * 1000
	if (end > circulationEnd) {
		clearTimeout(circulationTimer)
		circulationEnd = end
		circulationTimer = setTimeout(function () {
			circulationEnd = 0
			pumps.set(PIN_CIRCULATION_PUMP, false, function (err) {
				if (err)
					setError('failed to stop pump: ' + err)
			})
			sensors.enable(false)
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
		case 'base':
			pumpPin = PIN_BASE_PUMP
			break
		default:
			throw new Error('invalid pump specified')
	}

	var line = [new Date().toLocaleString(), pump, duration].join(',') + '\n'
	fs.appendFile('adjustments.csv', line, function (err) {
		if (err)
			setError('failed to log adjustment: ' + err)
	})

	circulate(duration + CIRCULATION_TIME)

	pumps.set(pumpPin, true, function (err) {
		if (err)
			setError('failed to start pump: ' + err)

		setTimeout(function () {
			pumps.set(pumpPin, false, function (err) {
				if (err)
					setError('failed to stop pump: ' + err)
			})
		}, duration * 1000)
	})
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

app.post('/runpump', function (req, res, next) {
	const pump = req.body.pump
	const duration = parseFloat(req.body.duration)
	if (duration <= 0 || duration > 60) {
		next(new Error('invalid pump duration'))
		return
	}

	var success = true
	if (adjusting) {
		success = false
	} else {
		try {
			runPump(pump, duration)
		} catch (e) {
			success = false
		}
	}

	res.setHeader('Content-Type', 'application/json')
	res.send(JSON.stringify({ success }))
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
