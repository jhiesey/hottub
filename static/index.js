const mainStateLabel = document.getElementById('main-state')
const circulationStateLabel = document.getElementById('circulation-state')
const flowLastGoodLabel = document.getElementById('flow-last-good')

const tempData = document.getElementById('temp-data')
const tempReading = document.getElementById('temp-reading')
const orpData = document.getElementById('orp-data')
const orpReading = document.getElementById('orp-reading')
const orpInfo = document.getElementById('orp-info')
const phData = document.getElementById('ph-data')
const phReading = document.getElementById('ph-reading')
const phInfo = document.getElementById('ph-info')
const flowData = document.getElementById('flow-data')
const flowReading = document.getElementById('flow-reading')
const flowInfo = document.getElementById('flow-info')

const historyChartCanvas = document.getElementById('history-chart')

const logTableBody = document.getElementById('log-table-body')

const resetButton = document.getElementById('reset-button')

const ORP_COLOR = 'rgb(54, 162, 235)'
const PH_COLOR = 'rgb(255, 99, 132)'

const historyChart = new Chart(historyChartCanvas, {
	type: 'line',
	data: {
		datasets: [{
			id: 'orp',
			label: 'ORP',
			borderColor: ORP_COLOR,
			backgroundColor: ORP_COLOR,
			fill: false,
			data: [],
			yAxisID: 'orp'
		},
		{
			id: 'ph',
			label: 'pH',
			borderColor: PH_COLOR,
			backgroundColor: PH_COLOR,
			fill: false,
			data: [],
			yAxisID: 'ph'
		}]
	},
	options: {
		responsive: true,
		stacked: false,
		title: {
			display: true,
			text: 'Readings history'
		},
		scales: {
			xAxes: [{
				type: 'time',
				distribution: 'linear'
			}],
			yAxes: [{
				id: 'orp',
				type: 'linear',
				position: 'left',
				scaleLabel: {
					display: true,
					fontColor: ORP_COLOR,
					labelString: 'ORP (mV)'
				},
				ticks: {
					fontColor: ORP_COLOR,
					suggestedMin: 550,
					suggestedMax: 800,
					stepSize: 50
				}
			},{
				id: 'ph',
				type: 'linear',
				position: 'right',
				scaleLabel: {
					display: true,
					fontColor: PH_COLOR,
					labelString: 'pH'
				},
				ticks: {
					fontColor: PH_COLOR,
					suggestedMin: 6,
					suggestedMax: 8,
					stepSize: 0.2
				}
			}]
		}
	}
})

const mainStates = {
	MEASURE_DELAY: ({}) => ({
		description: 'Preparing to check water conditions'
	}),
	DISPENSE: ({ pump, durationSeconds }) => ({
		description: `Dispensing ${pump} for ${durationSeconds} seconds`
	}),
	MIX: () => ({
		description: 'Mixing water'
	}),
	IDLE: () => ({
		description: 'Idle'
	}),
	RESETTABLE_ERROR: ({ message }) => ({
		description: `ERROR: ${message}`,
		className: 'state-bad'
	}),
	FATAL_ERROR: ({ message }) =>  ({
		description: `MAJOR ERROR; must power cycle: ${message}`,
		className: 'state-bad'
	})
}

const circulationStates = {
	OFF: {
		description: 'pump off'
	},
	ON_NO_FLOW: {
		description: 'pump on but no flow!',
		className: 'state-bad'
	},
	ON_FLOW_GOOD: {
		description: 'water flowing; waiting for sensor delay',
		className: 'state-good'
	},
	ON_READINGS_ACCURATE: {
		description: 'water flowing and readings accurate',
		className: 'state-good'
	}
}

const readingInfoDisplay = {
	OK: {
		description: 'OK',
		className: 'ok-reading'
	},
	VERY_LOW: {
		description: 'very low!',
		className: 'very-low-reading'
	},
	TOO_LOW: {
		description: 'too low',
		className: 'too-low-reading'
	},
	SLIGHTLY_LOW: {
		description: 'slightly low',
		className: 'slightly-low-reading'
	},
	VERY_HIGH: {
		description: 'very high!',
		className: 'very-high-reading'
	},
	TOO_HIGH: {
		description: 'too high',
		className: 'too-high-reading'
	},
	SLIGHTLY_HIGH: {
		description: 'slightly high',
		className: 'slightly-high-reading'
	}
}
const getReadingInfoDisplay = (circulationState, info) => {
	const displayData = readingInfoDisplay[info]

	const description = displayData?.description ?? 'unknown'
	const className = circulationState === 'ON_READINGS_ACCURATE' && displayData ? displayData.className : 'inaccurate-reading'

	return {
		description,
		className
	}
}

const logClassNameForLevel = {
	WARNING: 'log-level-warning',
	RESETTABLE_ERROR: 'log-level-resettable-error',
	RESETTABLE_ERROR_RESET: 'log-level-resettable-error-reset',
	FATAL_ERROR: 'log-level-fatal-error'
}

let loadTimer = null
const load = async () => {
	if (loadTimer) {
		clearTimeout(loadTimer)
	}
	loadTimer = null

	const response = await fetch('/data')
	const body = await response.json()

	console.log(body)

	const {
		readings,
		mainState,
		mainSubState,
		circulationState,
		flowLastGood,
		recentLogEntries,
		recentReadings
	} = body

	const mainStateInfo = mainStates[mainState]?.(mainSubState)
	mainStateLabel.textContent = mainStateInfo?.description ?? 'unknown'
	mainStateLabel.className = mainStateInfo?.className ?? ''

	resetButton.disabled = mainState !== 'RESETTABLE_ERROR'

	const circulationStateInfo = circulationStates[circulationState]
	circulationStateLabel.textContent = circulationStateInfo?.description ?? 'unknown'
	circulationStateLabel.className = circulationStateInfo?.className ?? ''

	flowLastGoodLabel.textContent = flowLastGood

	const tempInfoDisplay = getReadingInfoDisplay(circulationState, 'OK')
	tempData.className = tempInfoDisplay.className
	tempReading.textContent = readings.temp

	const orpInfoDisplay = getReadingInfoDisplay(circulationState, readings.info.orp)
	orpData.className = orpInfoDisplay.className
	orpReading.textContent = readings.orp
	orpInfo.textContent = orpInfoDisplay.description

	const phInfoDisplay = getReadingInfoDisplay(circulationState, readings.info.ph)
	phData.className = phInfoDisplay.className
	phReading.textContent = readings.ph
	phInfo.textContent = phInfoDisplay.description

	const flowInfoDisplay = getReadingInfoDisplay(circulationState, readings.info.flow)
	flowData.className = flowInfoDisplay.className
	flowReading.textContent = readings.flow
	flowInfo.textContent = flowInfoDisplay.description

	logTableBody.innerHTML = recentLogEntries.map(({ time, logLevel, message }) => {
		const logClassName = logClassNameForLevel[logLevel] ?? ''

		return `<tr class="${logClassName}"><td>${new Date(time).toLocaleString()}</td><td>${logLevel}</td><td>${message}</td></tr>`
	}).join('')

	const newDatasets = { orp: [], ph: [] }
	for (const { readings, time } of recentReadings) {
		const t = new Date(time)

		newDatasets.orp.push({
			t,
			y: readings.orp
		})

		newDatasets.ph.push({
			t,
			y: readings.ph
		})
	}
	for (const dataset of historyChart.data.datasets) {
		dataset.data = newDatasets[dataset.id]
	}
	historyChart.update()

	loadTimer = setTimeout(load, 500)
}

resetButton.onclick = async () => {
	const result = await fetch('/reset', {
		method: 'POST'
	})

	if (result.ok) {
		await load()
		alert('Reset successful')
	} else {
		alert('Reset failed')
	}
}

load()
