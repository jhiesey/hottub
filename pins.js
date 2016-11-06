const async = require('async')
const fs = require('fs')
const EventEmitter = require('events')

class Pins extends EventEmitter {
	constructor (pinNumbers) {
		var self = this
		self._pins = pinNumbers
		self.ready = false

		async.parallel(Object.keys(pinNumbers).map(function (pin) {
			const config = pinNumbers[pin]
			const dirIn = !!config.in
			return function (cb) {
				var pindir = '/sys/class/gpio/gpio' + pin
				async.series([
					function (cb) {
						fs.access(pindir, function (err) {
							if (err)
								fs.writeFile('/sys/class/gpio/export', pin.toString(), cb)
							else
								cb()
						})
					},
					function (cb) {
						fs.writeFile(pindir + '/direction', dirIn ? 'in' : 'out', cb)
					},
					function (cb) {
						fs.writeFile(pindir + '/edge', 'none', cb)
					},
					function (cb) {
						if (!dirIn)
							fs.writeFile(pindir + '/value', '0', cb)
						else
							cb()
					}
				], cb)
			}
		}), function (err) {
			if (err) {
				self.emit('error', err)
			} else {
				self.ready = true
				self.emit('ready')
			}
		})
	}

	set (pin, value, cb) {
		var self = this

		if (!self._pins[pin] || self._pins[pin].in) {
			process.nextTick(function () {
				cb(new Error('pin not configured: ' + pin))
			})
			return
		}

		if (!self.ready) {
			self.once('ready', self.set(pin, value, cb))
			return
		}

		fs.writeFile('/sys/class/gpio/gpio' + pin + '/value', value ? '1' : '0', cb)
	}

	get (pin, cb) {
		var self = this

		if (!self._pins[pin]) {
			process.nextTick(function () {
				cb(new Error('pin not configured'))
			})
			return
		}

		if (!self.ready) {
			self.once('ready', self.get(pin, cb))
			return
		}

		fs.readFile('/sys/class/gpio/gpio' + pin + '/value', 'utf8', function (err, data) {
			if (!err && data === '1') {
				cb(null, true)
			} else if (!err && data === '0') {
				cb(null, false)
			} else {
				cb(err || new Error('unknown value'))
			}
		})
	}
}
