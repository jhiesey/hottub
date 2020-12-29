const http = require('http')
const pug = require('pug')
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')

exports.makeServer = ({ getWebData, reset, port }) => {
	const app = express()
	const httpServer = http.createServer(app)
	app.set('views', path.join(__dirname, 'views'))
	app.set('view engine', 'pug')
	app.set('x-powered-by', false)
	app.engine('pug', pug.renderFile)

	app.use(express.static(path.join(__dirname, 'static')))
	app.use(bodyParser.json())

	app.get('/', function (req, res, next) {
		res.render('index')
	})

	app.get('/data', (req, res, next) => {
		// returns once reading done
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
