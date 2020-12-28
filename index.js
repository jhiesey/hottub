const Sensors = require('./sensors')
const Pins = require('./pins')
const { makeServer } = require('./server')
const { makeStateMachine } = require('./stateMachine')

const fs = require('fs')
const subprocess = require('child_process')
const util = require('util')
const fsPromises = require('fs/promises')
const nodemailer = require('nodemailer')

const HTTP_PORT = 80

// PINS
const PIN_CIRCULATION_PUMP = 24
const PIN_BLEACH_PUMP = 9
const PIN_ACID_PUMP = 25
const PIN_BICARB_PUMP = 11

const PIN_ERROR_IN = 8
const PIN_FLOW_IN = 7

// BASIC TIMING
const SENSOR_READING_DELAY = 40 // seconds
const MIX_TIME = 15 * 60 // 15 minutes
const IDLE_TIME = 30 * 60 // 30 minutes
const POWER_ON_DELAY = 60 * 60 // 1 hour
const MIN_LOG_MEASUREMENT_INTERVAL = 60 * 5 // 5 minutes
const WEB_SENSOR_CIRCULATE_TIME = 20 // seconds
const CIRCULATION_TIMEOUT = 60 // seconds

// SANITY PARAMETERS
const PH_HARD_MIN = 5.8
const PH_HARD_MAX = 9.2
const ORP_HARD_MIN = 100
const ORP_HARD_MAX = 900
const MAX_NO_PROGRESS_DISPENSES = 6

// GENERAL CONFIG
const CIRCULATION_ENABLED_STATES = ['MEASURE_DELAY', 'DISPENSE', 'MIX']

// ADJUSTMENT FACTORS
const PH_MIN = 7
const PH_MAX = 7.6
const ACID_SECONDS_PER_UNIT = 35
const ACID_GAIN = 0.8
const ACID_EXTRA_UNITS = 0.15
const ACID_MAX_SECONDS = 20

const ORP_MIN = 690
const ORP_MAX = 800
const BLEACH_SECONDS_PER_MV = 0.6
const ORP_GAIN = 1.8
const BLEACH_EXTRA_MV = 10
const BLEACH_MAX_SECONDS = 55

// LOGS
const RECENT_LOG_COUNT = 20
const RECENT_MEASUREMENT_COUNT = 100

const EMAIL_LOG_LEVELS = ['RESETTABLE_ERROR', 'RESETTABLE_ERROR_RESET', 'FATAL_ERROR']
const RECENT_LOG_LEVELS = ['MESSAGE', 'WARNING', 'RESETTABLE_ERROR', 'RESETTABLE_ERROR_RESET', 'FATAL_ERROR']
const RECENT_READING_LOG_LEVELS = ['READING', 'MEASUREMENT']

const EMAIL_PREFS = require('../emailPrefs.json')

// Start of code
const sensors = new Sensors()
sensors.setMaxListeners(Infinity)

var pinDefs = {}
pinDefs[PIN_CIRCULATION_PUMP] = { in: false }
pinDefs[PIN_BLEACH_PUMP] = { in: false }
pinDefs[PIN_ACID_PUMP] = { in: false }
pinDefs[PIN_BICARB_PUMP] = { in: false }
pinDefs[PIN_FLOW_IN] = { in: true, edge: 'both' }
pinDefs[PIN_ERROR_IN] = { in: true, edge: 'rising' }
var pins = new Pins(pinDefs)
const getPin = util.promisify((pinNum, cb) => pins.get(pinNum, cb));
const setPin = util.promisify((pinNum, value, cb) => pins.set(pinNum, value, cb));

let webSensorTimer = null
const startStopCirculation = async () => {
	if (webSensorTimer || CIRCULATION_ENABLED_STATES.includes(mainStateMachine.getState())) {
		const currentState = circulationStateMachine.getState()
		if (currentState === 'OFF') {
			circulationStateMachine.setState('ON_NO_FLOW')
		}
	} else {
		circulationStateMachine.setState('OFF')
	}
}

const getWebData = async () => {
	if (webSensorTimer) {
		clearTimeout(webSensorTimer)
	}

	webSensorTimer = setTimeout(() => {
		webSensorTimer = null
		startStopCirculation()
	}, WEB_SENSOR_CIRCULATE_TIME * 1000)

	startStopCirculation()

	const readings = await getReadings()

	return {
		readings,
		mainState: mainStateMachine.getState(),
		mainSubState: mainStateMachine.getSubState(),
		circulationState: circulationStateMachine.getState(),
		flowLastGood,
		recentLogEntries,
		recentReadings
	}
}

const getReadings = () => {
	return new Promise((resolve, reject) => {
		sensors.once('reading', (reading) => {
			const info = getReadingsInfo(reading)
			resolve({
				...reading,
				info
			})
		})

		sensors.once('error', (error) => {
			reject(error)
		})
	})
}
const getReadingsInfo = (reading) => {
	const { ph, orp } = reading

	let phInfo
	if (ph < PH_HARD_MIN) {
		phInfo = 'SUPER_LOW'
	} else if (ph < PH_MIN) {
		phInfo = 'LOW'
	} else if (ph > PH_HARD_MAX) {
		phInfo = 'SUPER_HIGH'
	} else if (ph > PH_MAX) {
		phInfo = 'HIGH'
	} else {
		phInfo = 'OK'
	}

	let orpInfo
	if (orp < ORP_HARD_MIN) {
		orpInfo = 'SUPER_LOW'
	} else if (orp < ORP_MIN) {
		orpInfo = 'LOW'
	} else if (orp > ORP_HARD_MAX) {
		orpInfo = 'SUPER_HIGH'
	} else if (orp > ORP_MAX) {
		orpInfo = 'HIGH'
	} else {
		orpInfo = 'OK'
	}

	return {
		ph: phInfo,
		orp: orpInfo
	}
}

const mailer = nodemailer.createTransport(EMAIL_PREFS.config)
const sendEmail = async (logLevel, message, time) => {
	const data = await getWebData()
	const { readings, circulationState, flowLastGood } = data

	const circulation = {
		OFF: 'Pump off',
		ON_NO_FLOW: 'Pump on but no flow!',
		ON_FLOW_GOOD: 'Water flowing'
	}[circulationState]

	const text =
`${message}

Time: ${time.toLocaleString()}

Temp: ${readings.temp}
ORP: ${readings.orp} (${readings.info.orp})
pH: ${readings.ph} (${readings.info.ph})

Circulation: ${circulation}
Flow Last Good: ${flowLastGood.toLocaleString()}
`

	console.log(`Sent email: ${logLevel} ${text}`)

	const to = Array.isArray(EMAIL_PREFS.to) ? EMAIL_PREFS.to.join(', ') : EMAIL_PREFS.to
	await mailer.sendMail({
		from: EMAIL_PREFS.from,
		to,
		subject: `HotBot ${logLevel}`,
		text
	})
}


const recentLogEntries = []
const addLogEntry = async (logLevel, message, time) => {
	if (!time) {
		time = new Date()
	}

	const logEntry = {
		time,
		logLevel,
		message
	}

	const logLine = [time.toLocaleDateString(), time.toLocaleTimeString(), logLevel, message].join(',')
	console.log(logLine)
	await fsPromises.appendFile('../event-log.csv', logLine + '\n')

	if (RECENT_LOG_LEVELS.includes(logLevel)) {
		while (recentLogEntries.length >= RECENT_LOG_COUNT) {
			recentLogEntries.shift()
		}
		recentLogEntries.push(logEntry)
	}

	if (EMAIL_PREFS.enable && EMAIL_LOG_LEVELS.includes(logLevel)) {
		await sendEmail(logLevel, message, time)
	}
}

const recentReadings = []
const logReadings = async (readings, isAdjsutmentMeasurement = false) => {
	const time = new Date()

	const lastReading = recentReadings[recentReadings.length - 1]
	if (isAdjsutmentMeasurement || !lastReading || time.getTime() >= lastReading.time.getTime() + MIN_LOG_MEASUREMENT_INTERVAL * 1000) {
		while (recentReadings.length >= RECENT_MEASUREMENT_COUNT) {
			recentReadings.shift()
		}
		recentReadings.push({
			time,
			readings
		})
	}

	await addLogEntry('READINGS', JSON.stringify(readings), time)
}


sensors.on('reading', (readings) => {
	const info = getReadingsInfo(readings)
	logReadings({
		...readings,
		info
	})
})

const flowState = {
	get: async () => {
		const value = await getPin(PIN_FLOW_IN)
		return value
	},

	onChange: (handler) => {
		let listener = (pin, value) => {
			if (pin === PIN_FLOW_IN) {
				handler(value)
			}
		}

		const cancel = () => {
			if (listener) {
				pins.removeListener('edge', listener)
				listener = null
			}
		}

		pins.on('edge', listener)

		return {
			cancel
		}
	}
}

let lastPump = null
let lastPumpDuration = 0
let noProgressCount = 0
const mainStateMachine = makeStateMachine({
	states: {
		MEASURE_DELAY: {
			onFlowGood: async ({ setTimer }, { durationSeconds }) => {
				setTimer(durationSeconds)
			},
			onTimer: async ({ setState }) => {
				const readings = await getReadings()
				const { info } = readings

				await logReadings(readings, true)

				let pump = null
				let durationSeconds = 0
				if (info.ph === 'SUPER_HIGH' || info.ph === 'SUPER_LOW' || info.orp === 'SUPER_HIGH' || info.orp === 'SUPER_LOW') {
					let message = `Readings out of range:`;
					if (info.orp === 'SUPER_HIGH' || info.orp === 'SUPER_LOW') {
						message += ` ORP = ${readings.orp} mV`
					}
					if (info.ph === 'SUPER_HIGH' || info.ph === 'SUPER_LOW') {
						message += ` pH = ${readings.ph}`
					}

					await setState('RESETTABLE_ERROR', { message })
					return
				} else if (info.ph === 'HIGH') {
					pump = 'acid'
					durationSeconds = Math.min(((readings.ph - PH_MAX) * ACID_GAIN + ACID_EXTRA_UNITS) * ACID_SECONDS_PER_UNIT, ACID_MAX_SECONDS)
				} else if (info.orp === 'LOW') {
					pump = 'bleach'
					durationSeconds = Math.min(((ORP_MIN - readings.orp) * ORP_GAIN + BLEACH_EXTRA_MV) * BLEACH_SECONDS_PER_MV, BLEACH_MAX_SECONDS)
				}

				// Round to nearest 0.1 second for logging cleanliness
				durationSeconds = Math.round(durationSeconds * 10) / 10

				if (pump !== null && pump === lastPump && durationSeconds >= lastPumpDuration) {
					noProgressCount += 1

					if (noProgressCount > MAX_NO_PROGRESS_DISPENSES) {
						noProgressCount = 0
						await setState('RESETTABLE_ERROR', { message: `Adding ${pump} is having no effect. Check the chemical level.` })
						return
					}
				} else {
					noProgressCount = 0
				}
				lastPump = pump
				lastPumpDuration = durationSeconds

				if (durationSeconds > 0) {
					await addLogEntry('MESSAGE', `Dispensing ${pump} for ${durationSeconds} seconds`)

					await setState('DISPENSE', { pump, durationSeconds })
				} else {
					await setState('IDLE', { durationSeconds: IDLE_TIME })
				}
			}
		},

		DISPENSE: {
			onEnter: ({}, { pump, durationSeconds }) => {
				let dispensingPin

				switch (pump) {
					case 'bleach':
						dispensingPin = PIN_BLEACH_PUMP
						break
					case 'acid':
						dispensingPin = PIN_ACID_PUMP
						break
					case 'bicarbonate':
						dispensingPin = PIN_BICARB_PUMP
						break
					default:
						throw new Error(`Invalid pump specified: ${pump}`)
				}

				return {
					pump,
					dispensingPin,
					durationSeconds
				}
			},
			onLeave: async ({}, { dispensingPin }) => {
				// Stop pump
				await setPin(dispensingPin, false)
			},
			onFlowGood: async ({ setTimer }, { dispensingPin, durationSeconds }) => {
				// Start pump
				await setPin(dispensingPin, true)

				// Set timer to turn off pump
				await setTimer(durationSeconds)
			},
			onFlowBad: async ({ setState }) => {
				await setState('MIX')
				await addLogEntry('WARNING', 'Flow unexpectedly stopped during dispensing')
			},
			onTimer: async ({ setState }) => {
				await setState('MIX')
			}
		},

		MIX: {
			onFlowGood: async ({ setTimer }) => {
				console.log('MIX FLOW GOOD')
				await setTimer(MIX_TIME)
			},
			onTimer: async ({ setState }) => {
				await setState('MEASURE_DELAY', { durationSeconds: SENSOR_READING_DELAY })
			}
		},

		IDLE: {
			onEnter: async ({ setTimer }, { durationSeconds }) => {
				await setTimer(durationSeconds)
			},
			onTimer: async ({setState}) => {
				await setState('MEASURE_DELAY', { durationSeconds: SENSOR_READING_DELAY })
			}
		},

		RESETTABLE_ERROR: {
			onEnter: async ({}, { message }) => {
				await addLogEntry('RESETTABLE_ERROR', message)
			},
			onLeave: async ({}, { message }) => {
				await addLogEntry('RESETTABLE_ERROR_RESET', `The following error has been reset: ${message}`)
			}
		},

		FATAL_ERROR: {
			onEnter: async ({}, { message }) => {
				await addLogEntry('FATAL_ERROR', message)
			}
		}
	},
	initialState: 'MEASURE_DELAY',
	initialParams: { durationSeconds: POWER_ON_DELAY },
	flowState,
	onStateChange: async (stateName) => {
		startStopCirculation()
		await addLogEntry('MAIN_STATE', stateName)
	}
})

let flowLastGood = 'never'
const circulationStateMachine = makeStateMachine({
	states: {
		OFF: {
			onEnter: async () => {
				sensors.enable(false)
				await setPin(PIN_CIRCULATION_PUMP, false)
			}
		},
		ON_NO_FLOW: {
			onEnter: async ({ setTimer }) => {
				await setPin(PIN_CIRCULATION_PUMP, true)
				sensors.enable(true)
				await setTimer(CIRCULATION_TIMEOUT)
			},
			onFlowGood: async ({ setState }) => {
				await setState('ON_FLOW_GOOD')
			},
			onTimer: async ({ setState }) => {
				await mainStateMachine.setState('RESETTABLE_ERROR', { message: `Circulation flow was not present for ${CIRCULATION_TIMEOUT} seconds. Check the filter and make sure the pump is primed.` })
			}
		},
		ON_FLOW_GOOD: {
			onEnter: async () => {
				flowLastGood = 'now'
			},
			onLeave: async () => {
				flowLastGood = new Date()
			},
			onFlowBad: async ({ setTimer }) => {
				await setState('ON_NO_FLOW')
			}
		}
	},
	initialState: 'OFF',
	flowState,
	onStateChange: async (stateName) => {
		await addLogEntry('FLOW_STATE', stateName)
	}
})

const server = makeServer({
	port: HTTP_PORT,
	getWebData,
	reset: async () => {
		if (mainStateMachine.getState() === 'RESETTABLE_ERROR') {
			await mainStateMachine.setState('MEASURE_DELAY', { durationSeconds: SENSOR_READING_DELAY })
		}
	}
})

const start = async () => {
	try {
		await addLogEntry('MESSAGE', 'Bootup')

		const promises = [circulationStateMachine.run(), mainStateMachine.run(), server.run()]

		pins.on('edge', (pin, value) => {
			if (value && pin === PIN_ERROR_IN) {
				mainStateMachine.setState('FATAL_ERROR', { message: `Failsafe pin triggered during operation`})
			}
		})

		const errorPin = await getPin(PIN_ERROR_IN)
		if (errorPin) {
			mainStateMachine.setState('FATAL_ERROR', { message: `Failsafe pin triggered on power up`})
		}

		await Promise.all(promises)
	} catch (error) {
		await addLogEntry('FATAL_ERROR', `Caught exception: ${error}`)
	}
}

pins.on('ready', start) // This starts the program
