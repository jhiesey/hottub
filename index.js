const http = require('http')
const pug = require('pug')
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')

const Sensors = require('./sensors')
const Pins = require('./pins')
const fs = require('fs')

const sensors = new Sensors()
sensors.on('reading', function (reading) {
	if (!sensorsAccurate)
		return

	var line = [new Date().toLocaleString(), reading.temp, reading.ph, reading.orp].join(',') + '\n'
	fs.appendFile('log.csv', line, function (err) {
		if (err)
			console.error('failed to log!')
	})
})

const PIN_CIRCULATION_PUMP = 24
const PIN_CHLORINE_PUMP = 25
const PIN_ACID_PUMP = 11
const PIN_BASE_PUMP = 9

const PIN_FAILSAFE_IN = 8
const PIN_FLOW_IN = 7

const CIRCULATION_TIME = 3600 // seconds; 1 hour
const READING_CIRCULATION_TIME = 30 // seconds
const SENSOR_READING_DELAY = 120 // seconds
const SENSOR_READING_TIME = 30 // seconds

var pumpPins = {}
pumpPins[PIN_CIRCULATION_PUMP] = { in: false }
pumpPins[PIN_CHLORINE_PUMP] = { in: false }
pumpPins[PIN_ACID_PUMP] = { in: false }
pumpPins[PIN_BASE_PUMP] = { in: false }

var pumps = new Pins(pumpPins)
pumps.on('ready', function () {
	checkAndAdjust()
	httpServer.listen(80)
})

var app = express()
var httpServer = http.createServer(app)
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')
app.set('x-powered-by', false)
app.engine('pug', pug.renderFile)

app.use(express.static(path.join(__dirname, 'static')))
app.use(bodyParser.json())

app.get('/', function (req, res, next) {
	res.render('index')
})

const CHECK_INTERVAL = 1800 // seconds

const PH_HARD_MIN = 5.8
const PH_HARD_MAX = 8.5
const ORP_HARD_MIN = 100
const ORP_HARD_MAX = 900

const PH_MAX = 7.7
const ACID_SECONDS_PER_UNIT = 50
const ACID_MIN_SECONDS = 5
const ACID_MAX_SECONDS = 20
const ACID_DELAY = 1800

const PH_MIN = 0 // 7.3
const BASE_SECONDS_PER_UNIT = 50 // TODO: establish this
const BASE_MIN_SECONDS = 0 // TODO: establish this
const BASE_MAX_SECONDS = 0 // TODO: establish this

const BASE_DELAY = 1800

const ORP_MIN = 700
const CHLORINE_SECONDS_PER_MV = 0.25
const CHLORINE_MIN_SECONDS = 5
const CHLORINE_MAX_SECONDS = 30
const CHLORINE_DELAY = 3600

function between (value, min, max) {
	return Math.min(Math.max(value, min), max)
}

function checkAndAdjust () {
	getAccurateReading(function (err, reading) {
		var duration = 0
		var pump
		var delay = CHECK_INTERVAL
		if (err) {
			console.error('failed to take reading:', err)
		} else if (reading.ph < PH_HARD_MIN || reading.ph > PH_HARD_MAX || reading.orp < ORP_HARD_MIN || reading.orp > ORP_HARD_MAX) {
			console.error('WEIRD READING! NOT ADJUSTING!')
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
				console.error('failed to start pump:', err)
		})
		sensors.enable(true)
		// set accurate flag after delay
		setTimeout(function () {
			if (circulationEnd !== 0) {
				sensorsAccurate = true
			}

		}, SENSOR_READING_DELAY * 1000)
	}

	const end = Date.now() + duration * 1000
	if (end > circulationEnd) {
		clearTimeout(circulationTimer)
		circulationEnd = end
		circulationTimer = setTimeout(function () {
			circulationEnd = 0
			pumps.set(PIN_CIRCULATION_PUMP, false, function (err) {
				if (err)
					console.error('failed to stop pump:', err)
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

	circulate(duration + CIRCULATION_TIME)

	pumps.set(pumpPin, true, function (err) {
		if (err)
			console.error('failed to start pump:', err)

		setTimeout(function () {
			pumps.set(pumpPin, false, function (err) {
				if (err)
					console.error('failed to stop pump:', err)
			})
		}, duration * 1000)
	})
}

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
			accurate: sensorsAccurate
		}
		res.send(JSON.stringify(fullReading))
	})
})

app.post('/runpump', function (req, res, next) {
	const pump = req.body.pump
	const duration = parseFloat(req.body.duration)
	if (duration === 0 || duration > 30) {
		next(new Error('invalid pump duration'))
		return
	}

	try {
		runPump(pump, duration)
	} catch (e) {
		next(e)
	}
	res.setHeader('Content-Type', 'application/json')
	res.send(JSON.stringify({ success: true }))
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

function error (err) {
  console.error(err.stack || err.message || err)
}

/*
every hour:
	request readings
	compute required chemicals
	inject chlorine (if needed)
	inject acid (if needed)
	inject base (if needed)
*/
