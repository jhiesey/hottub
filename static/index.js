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
		description: 'Pump off'
	},
	ON_NO_FLOW: {
		description: 'Pump on but no flow!',
		className: 'state-bad'
	},
	ON_FLOW_GOOD: {
		description: 'Water flowing',
		className: 'state-good'
	}
}

const readingClassNames = {
	OK: 'ok-reading',
	LOW: 'low-reading',
	HIGH: 'high-reading',
	SUPER_LOW: 'super-low-reading',
	SUPER_HIGH: 'super-high-reading'
}

const getReadingClassName = (circulationState, info) => {
	if (circulationState !== 'ON_FLOW_GOOD') {
		return 'inaccurate-reading'
	}

	return readingClassNames[info] ?? ''
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
	mainStateLabel.innerHTML = mainStateInfo?.description ?? 'unknown'
	mainStateLabel.className = mainStateInfo?.className ?? ''

	resetButton.disabled = mainState !== 'RESETTABLE_ERROR'

	const circulationStateInfo = circulationStates[circulationState]
	circulationStateLabel.innerHTML = circulationStateInfo?.description ?? 'unknown'
	circulationStateLabel.className = circulationStateInfo?.className ?? ''

	flowLastGoodLabel.innerHTML = flowLastGood

	tempData.className = getReadingClassName(circulationState, 'OK')
	tempReading.innerHTML = readings.temp

	orpData.className = getReadingClassName(circulationState, readings.info.orp)
	orpReading.innerHTML = readings.orp
	orpInfo.innerHTML = readings.info.orp.replace('_', ' ')

	phData.className = getReadingClassName(circulationState, readings.info.ph)
	phReading.innerHTML = readings.ph
	phInfo.innerHTML = readings.info.ph.replace('_', ' ')

	logTableBody.innerHTML = recentLogEntries.map(({ time, logLevel, message }) => {
		return `<tr><td>${new Date(time).toLocaleString()}</td><td>${logLevel}</td><td>${message}</td></tr>`
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
