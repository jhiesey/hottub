const async = require('async')
const fs = require('fs')
const Epoll = require('epoll').Epoll
const EventEmitter = require('events')

class Pins extends EventEmitter {
	constructor (pinNumbers) {
		super()
		var self = this
		self._pins = {}
		self._fds = {}
		self._poller = null
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
						fs.open(pindir + '/value', 'r+', function (err, fd) {
							if (err) return cb(err)
							pin.fd = fd
							self._fds[fd] = pinNum
							if (edge) {
								self._createPoller()
								// prevent initial interrupt
								self._dummyRead(fd, function (err) {
									if (err) return (cb(err))
									self._poller.add(fd, Epoll.EPOLLPRI)
								})
							}
							cb()
						})
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

	_createPoller () {
		var self = this
		if (self._poller)
			return

		self._poller = new Epoll(function (err, fd, events) {
			if (err) return self.emit('error', err)
			var pinNum = self._fds[fd]
			if (pinNum === undefined) return self.emit('error', new Error('unexpected pin interrupt'))
			self.emit('edge', pinNum)
			// clear interrupt
			self._dummyRead(fd, function (err) {
				if (err) return self.emit('error', err)
			})
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
			self.once('ready', self.set.bind(self, pin, value, cb))
			return
		}

		var buf
		if (value) {
			buf = Buffer.from('1')
		} else {
			buf = Buffer.from('0')
		}
		cb = cb || function () {}
		fs.write(self._pins[pin].fd, buf, 0, 1, 0, cb)
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
			self.once('ready', self.get.bind(self, pin, cb))
			return
		}

		var buf = Buffer.alloc(1)
		fs.read(self._pins[pin].fd, buf, 0, 1, 0, function (err, bytesRead) {
			if (err) return cb(err)

			if (bytesRead === 1 && buf[0].toString() === '0') {
				cb(null, false)
			} else if (bytesRead === 1 && buf[0].toString() === '1') {
				cb(null, true)
			} else {
				cb(new Error('unknown value'))
			}
		})
	}

	_dummyRead (fd, cb) {
		var buf = Buffer.alloc(1)
		fs.read(fd, buf, 0, 1, 0, function (err, bytesRead) {
			if (err) return cb(err)
			if (bytesRead !== 1) return cb(new Error('failed to read'))
		})
	}
}

module.exports = Pins

