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
	console.log('TEMP:', reading.temp)
	console.log('PH:', reading.ph)
	console.log('ORP:', reading.orp)

	console.log('accurate?', sensorsAccurate ? 'yes' : 'no')

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
	// TODO: never run pumps before this!
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

function getAccurateReading(cb) {
	circulate(SENSOR_READING_DELAY + SENSOR_READING_TIME)

	function onReading (reading) {
		if (!sensorsAccurate)
			return

		sensors.removeEventListener('reading', onReading)
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
		// enable readings after delay
		sensors.enable(true)
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
	})
	setTimeout(function () {
		pumps.set(pumpPin, false, function (err) {
			if (err)
				console.error('failed to stop pump:', err)
		})
	}, duration * 1000)
}

// returns once reading done
app.get('/reading', function (req, res, next) {
	circulate(READING_CIRCULATION_TIME)

	// blocks until the next reading
	sensors.once('reading', function (reading) {
		res.setHeader('Content-Type', 'application/json')
		res.send(JSON.stringify(reading))
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

httpServer.listen(80)

function error (err) {
  console.error(err.stack || err.message || err)
}

// pump design:
// * turn on pump
// * once flow reaches setpoint, run timer
// * once timer reaches limit, good to go



// so we have:
// startReadings(time)
// injectChemical(time)

/*
web endpoints:
	* home page
	* inject chemical (post)
	* enable readings (post) // sets timer
	* get reading history // takes time
	* get new reading // sets timer and blocks until new reading
*/







// const SENSOR_DELAY = 60 // seconds

// // requests:
// // *chemical injection
// // *measurements

// // check if enough time has elapsed
// sensors.on('reading', function (reading) {
// 	const circDuration = Date.now() - circulationStartTime
// 	if (circDuration / 1000 > SENSOR_DELAY) {
// 		console.log('TEMP:', reading.temp)
// 		console.log('PH:', reading.ph)
// 		console.log('ORP:', reading.orp)
// 	}
// })

// var circulationRef = 0
// var circulationStartTime
// function enableCirculation () {
// 	if (circulationRef++ === 0) {
// 		// enable circulation pump here
// 		circulationStartTime = Date.now()
// 		sensors.enable(true)
// 	}


// 	// automatically use the output
// }

// function disableCirculation () {
// 	if (--circulationRef === 0) {
// 		sensors.enable(false)
// 	}
// }

/*
when readings requested, start pump
after delay, start readings (or start immediately and ignore initially)

when page loaded, request readings
when websocket dies, stop readings

readings requests should be reference counted

every hour:
	request readings
	compute required chemicals
	inject chlorine (if needed)
	inject acid (if needed)
	inject base (if needed)
*/
