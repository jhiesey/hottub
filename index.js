var sensors = require('./sensors')

sensors.enable(true)

sensors.on('reading', function (reading) {
	console.log('TEMP:', reading.temp)
	console.log('PH:', reading.ph)
	console.log('ORP:', reading.orp)
})