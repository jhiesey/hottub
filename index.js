const Sensors = require('./sensors')
const Pins = require('./pins')
const fs = require('fs')

const sensors = new Sensors()
sensors.enable(true)
sensors.on('reading', function (reading) {
	console.log('TEMP:', reading.temp)
	console.log('PH:', reading.ph)
	console.log('ORP:', reading.orp)

	var line = [new Date().toLocaleString(), reading.temp, reading.ph, reading.orp].join(',') + '\n'
	fs.appendFile('log.csv', line, function (err) {
		if (err)
			console.error('failed to log!')
	})
})

const PIN_CIRCULATION_PUMP = 24
const PIN_CHLORINE_PUMP = 25
const PIN_ACID_PUMP = 8

var pumpPins = {}
pumpPins[PIN_CIRCULATION_PUMP] = { in: false }
pumpPins[PIN_CHLORINE_PUMP] = { in: false }
pumpPins[PIN_ACID_PUMP] = { in: false }

var pumps = new Pins(pumpPins, function (err) {
	if (err) return console.error(err)
	pumps.set(PIN_CIRCULATION_PUMP, true, function (err) {
		if(err)
			console.error('failed to start pump:', err)
	})
})

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
