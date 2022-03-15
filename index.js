const Sensors = require('./sensors')
const Pins = require('./pins')
const { makeServer } = require('./server')
const { makeStateMachine } = require('./stateMachine')
const { turnHeatOff } = require('./heater-api')

const fetch = require('node-fetch')
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
const SENSOR_READING_DELAY = 2 * 60 // 2 minutes
const MIX_TIME = 15 * 60 // 15 minutes
const IDLE_TIME = 30 * 60 // 30 minutes
const POWER_ON_DELAY = 60 * 60 // 1 hour
const WEB_SENSOR_CIRCULATE_TIME = 20 // seconds
const CIRCULATION_TIMEOUT = 60 // seconds
const PAUSE_DURATION = 3 * 60 * 60 // 3 hours

// SANITY PARAMETERS
const MAX_NO_PROGRESS_DISPENSES = 6

// GENERAL CONFIG
const CIRCULATION_ENABLED_STATES = ['MEASURE_DELAY', 'DISPENSE', 'MIX']

// LIMITS
const PH_HARD_MIN = 5.8
const PH_TOO_LOW = 6.5
const PH_MIN = 6.8
const PH_MAX = 7.6
const PH_TOO_HIGH = 8.0
const PH_HARD_MAX = 9.2

const ORP_HARD_MIN = 100
const ORP_TOO_LOW = 600
const ORP_MIN = 690
const ORP_MAX = 780
const ORP_TOO_HIGH = 800
const ORP_HARD_MAX = 900

const FLOW_HARD_MIN = 10
const FLOW_TOO_LOW = 15

const TEMP_TOO_HIGH = 45

// ADJUSTMENT FACTORS
const ACID_SECONDS_PER_UNIT = 35
const ACID_GAIN = 0.8
const ACID_EXTRA_UNITS = 0.1
const ACID_MAX_SECONDS = 10

const BLEACH_SECONDS_PER_MV = 0.6
const ORP_GAIN = 1.8
const BLEACH_EXTRA_MV = 10
const BLEACH_MAX_SECONDS = 55

// LOGS
// An extra second so that readingsAccurate goes true after the adustment
// mesasurement gets logged
const LOG_ACCURATE_DELAY = SENSOR_READING_DELAY + 1

const MIN_LOG_MEASUREMENT_INTERVAL = 5 * 60 // 5 minutes
const RECENT_LOG_COUNT = 20
const RECENT_MEASUREMENT_COUNT = 100

const EMAIL_LOG_LEVELS = ['RESETTABLE_ERROR', 'FATAL_ERROR']
const RECENT_LOG_LEVELS = ['MESSAGE', 'WARNING', 'RESETTABLE_ERROR', 'RESETTABLE_ERROR_RESET', 'FATAL_ERROR']

const EMAIL_PREFS = require('../emailPrefs.json')

// Start of code
const sensors = new Sensors()
sensors.setMaxListeners(Infinity)

const pinDefs = {}
pinDefs[PIN_CIRCULATION_PUMP] = { in: false }
pinDefs[PIN_BLEACH_PUMP] = { in: false }
pinDefs[PIN_ACID_PUMP] = { in: false }
pinDefs[PIN_BICARB_PUMP] = { in: false }
pinDefs[PIN_FLOW_IN] = { in: true, edge: 'both' }
pinDefs[PIN_ERROR_IN] = { in: true, edge: 'rising' }
const pins = new Pins(pinDefs)
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
const readingInfoDescriptions = {
	OK: 'OK',
	VERY_LOW: 'very low!',
	TOO_LOW: 'too low',
	SLIGHTLY_LOW: 'slightly low',
	VERY_HIGH: 'very high!',
	TOO_HIGH: 'too high',
	SLIGHTLY_HIGH: 'slightly high'
}
const getReadingsInfo = (reading) => {
	const { ph, orp, flow } = reading

	let phInfo
	if (ph < PH_HARD_MIN) {
		phInfo = 'VERY_LOW'
	} else if (ph < PH_TOO_LOW) {
		phInfo = 'TOO_LOW'
	} else if (ph < PH_MIN) {
		phInfo = 'SLIGHTLY_LOW'
	} else if (ph > PH_HARD_MAX) {
		phInfo = 'VERY_HIGH'
	} else if (ph > PH_TOO_HIGH) {
		phInfo = 'TOO_HIGH'
	} else if (ph > PH_MAX) {
		phInfo = 'SLIGHTLY_HIGH'
	} else {
		phInfo = 'OK'
	}

	let orpInfo
	if (orp < ORP_HARD_MIN) {
		orpInfo = 'VERY_LOW'
	} else if (orp < ORP_TOO_LOW) {
		orpInfo = 'TOO_LOW'
	} else if (orp < ORP_MIN) {
		orpInfo = 'SLIGHTLY_LOW'
	} else if (orp > ORP_HARD_MAX) {
		orpInfo = 'VERY_HIGH'
	} else if (orp > ORP_TOO_HIGH) {
		orpInfo = 'TOO_HIGH'
	} else if (orp > ORP_MAX) {
		orpInfo = 'SLIGHTLY_HIGH'
	} else {
		orpInfo = 'OK'
	}

	let flowInfo
	if (flow < FLOW_HARD_MIN) {
		flowInfo = 'VERY_LOW'
	} else if (flow < FLOW_TOO_LOW) {
		flowInfo = 'TOO_LOW'
	} else {
		flowInfo = 'OK'
	}

	let tempInfo
	if (temp > TEMP_TOO_HIGH) {
		tempInfo = 'TOO_HIGH'
	} else {
		tempInfo = 'OK'
	}

	return {
		ph: phInfo,
		orp: orpInfo,
		flow: flowInfo,
		temp: tempInfo
	}
}

const mailer = EMAIL_PREFS.enable ? nodemailer.createTransport(EMAIL_PREFS.config) : null
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

Temp: ${readings.temp} (${readingInfoDescriptions[readings.info.temp]})
ORP: ${readings.orp} (${readingInfoDescriptions[readings.info.orp]})
pH: ${readings.ph} (${readingInfoDescriptions[readings.info.ph]})

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
	const circulationState = circulationStateMachine.getState()
	if (circulationState !== 'ON_READINGS_ACCURATE') {
		return
	}

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
		PAUSED: {
			onEnter: async ({ setTimer }) => {
				await addLogEntry('MESSAGE', `Pausing chemical dispensing; will auto resume at ${(new Date(Date.now() + PAUSE_DURATION * 1000)).toLocaleTimeString()}`)
				await setTimer(PAUSE_DURATION)
			},
			onLeave: async () => {
				await addLogEntry('MESSAGE', 'Resuming chemical dispensing')
			},
			onTimer: async ({ setState }) => {
				await setState('MEASURE_DELAY', { durationSeconds: SENSOR_READING_DELAY })
			}
		},

		MEASURE_DELAY: {
			onFlowGood: async ({ setTimer }, { durationSeconds }) => {
				await setTimer(durationSeconds)
			},
			onTimer: async ({ setState }) => {
				const readings = await getReadings()
				const { info } = readings

				await logReadings(readings, true)

				if (info.temp === 'TOO_HIGH') {
					await setState('RESETTABLE_ERROR', { message: 'Too hot, shutting off!!!' })

					// Shut off heater
					fetch('http://10.0.0.95/sf/4.5').catch(err => {
						console.error(`Failed to turn off heat: ${err}`)
					})
					return
				}

				let pump = null
				let durationSeconds = 0
				if (info.ph === 'VERY_HIGH' || info.ph === 'VERY_LOW' || info.orp === 'VERY_HIGH' || info.orp === 'VERY_LOW') {
					let message = `Readings out of range:`;
					if (info.orp === 'VERY_HIGH' || info.orp === 'VERY_LOW') {
						message += ` ORP = ${readings.orp} mV`
					}
					if (info.ph === 'VERY_HIGH' || info.ph === 'VERY_LOW') {
						message += ` pH = ${readings.ph}`
					}

					await setState('RESETTABLE_ERROR', { message })
					return
				} else if (readings.ph > PH_MAX) {
					pump = 'acid'
					durationSeconds = Math.min(((readings.ph - PH_MAX) * ACID_GAIN + ACID_EXTRA_UNITS) * ACID_SECONDS_PER_UNIT, ACID_MAX_SECONDS)
				} else if (readings.orp < ORP_MIN) {
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
			onTimer: async ({ setState }) => {
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
				await mainStateMachine.setState('RESETTABLE_ERROR', {
					message: `Circulation flow was not present for ${CIRCULATION_TIMEOUT} seconds. Check the filter and make sure the pump is primed.`,
					isFlowError: true
				})
			}
		},
		ON_FLOW_GOOD: {
			onEnter: async ({ setTimer }) => {
				flowLastGood = 'now'
				await setTimer(LOG_ACCURATE_DELAY)
			},
			onLeave: async ({}, subState, nextState) => {
				if (nextState !== 'ON_READINGS_ACCURATE') {
					flowLastGood = new Date()
				}
			},
			onFlowBad: async ({ setState }) => {
				await setState('ON_NO_FLOW')
			},
			onTimer: async ({ setState }) => {
				await setState('ON_READINGS_ACCURATE')
			}
		},
		ON_READINGS_ACCURATE: {
			onEnter: async () => {
				// Auto-reset flow errors
				if (mainStateMachine.getState() === 'RESETTABLE_ERROR' && mainStateMachine.getSubState().isFlowError) {
					await mainStateMachine.setState('MEASURE_DELAY', { durationSeconds: SENSOR_READING_DELAY })
				}
			},
			onLeave: async () => {
				flowLastGood = new Date()
			},
			onFlowBad: async({ setState }) => {
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
	},
	setPaused: async (pause) => {
		const currentState = mainStateMachine.getState()
		if (currentState === 'RESETTABLE_ERROR' || currentState === 'FATAL_ERROR') {
			throw new Error('Must reset first')
		}

		if (pause) {
			await mainStateMachine.setState('PAUSED')
		} else {
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
