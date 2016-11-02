var sensors = require('./sensors')

sensors.enable(true)

const SENSOR_DELAY = 60 // seconds

// requests:
// *chemical injection
// *measurements

// check if enough time has elapsed
sensors.on('reading', function (reading) {
	const circDuration = Date.now() - circulationStartTime
	if (circDuration / 1000 > SENSOR_DELAY) {	
		console.log('TEMP:', reading.temp)
		console.log('PH:', reading.ph)
		console.log('ORP:', reading.orp)
	}
})

var circulationRef = 0
var circulationStartTime
function enableCirculation () {
	if (circulationRef++ === 0) {
		// enable circulation pump here
		circulationStartTime = Date.now()
		sensors.enable(true)
	}


	// automatically use the output
}

function disableCirculation () {
	if (--circulationRef === 0) {
		sensors.enable(false)
	}
}

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