const async = require('async')
const fs = require('fs')
const SocketWatcher = require('socketwatcher').SocketWatcher
const EventEmitter = require('events')

class Pins extends EventEmitter {
	constructor (pinNumbers) {
		super()
		var self = this
		self._pins = {}
		self.ready = false

		async.parallel(Object.keys(pinNumbers).map(function (pinNum) {
			const config = pinNumbers[pinNum]
			const dirIn = !!config.in
			const edge = config.edge || 'none'
			const edgeCb = config.change
			var pin = self._pins[pinNum] = {
				in: dirIn
			}
			return function (cb) {
				var pindir = '/sys/class/gpio/gpio' + pinNum
				async.series([
					function (cb) {
						fs.access(pindir, function (err) {
							if (err)
								fs.writeFile('/sys/class/gpio/export', pinNum.toString(), cb)
							else
								cb()
						})
					},
					function (cb) {
						fs.writeFile(pindir + '/direction', dirIn ? 'in' : 'out', cb)
					},
					function (cb) {
						fs.writeFile(pindir + '/edge', edge, cb)
					},
					function (cb) {
						if (edge !== 'none') {
							fs.open(pindir + '/value', 0, 'r+', function (err, fd) {
								if (err) return cb(err)
								pin.fd = fd
								pin.watcher = new SocketWatcher()
								pin.watcher.callback = edgeCb
								pin.watcher.set(fd, true, false)
								pin.watcher.start()
								cb()
							})
						} else {
							cb()
						}
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

module.exports = Pins

