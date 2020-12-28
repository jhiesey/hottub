/*
UI:
* state
* readings
* flow
* state timer

* errors
* reset button

* log:
	* warnings
	* errors/resets
	* dispense

*/

const http = require('http')
const pug = require('pug')
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')

exports.makeServer = ({ getWebData, reset, port }) => {
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
			// title: 'Hot Tub Status',
			// temp: lastReading ? lastReading.temp : '?',
			// ph: lastReading ? lastReading.ph : '?',
			// orp: lastReading ? lastReading.orp : '?',
			// sensorStatus: getStatus(),
			// flowGood: flowGood ? 'YES' : 'NO',
			// lastFlowGood: flowGood ? 'now' : (lastFlowGood ? lastFlowGood.toLocaleDateString() : 'never'),
			// fatalError: fatalError || 'none'
		})
	})

	// returns once reading done
	app.get('/data', (req, res, next) => {
		getWebData().then((data) => {
			res.setHeader('Content-Type', 'application/json')
			res.send(JSON.stringify(data))
		}, (error) => {
			res.status(500).render('error', {
				title: '500 Server Error - hottub.local',
				message: error.message ?? error
			})
		})
	})

	app.post('/reset', (req, res, next) => {
		reset().then(() => {
			res.status(200).send('ok')
		}, (error) => {
			res.status(500).render('error', {
				title: '500 Server Error - hottub.local',
				message: error.message ?? error
			})
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
		console.error(err.stack ?? err.message ?? err)

		error(err)
		res.status(500).render('error', {
			title: '500 Server Error - hottub.local',
			message: err.message ?? err
		})
	})

	return {
		run: () => {
			httpServer.listen(port)
		}
	}
}
