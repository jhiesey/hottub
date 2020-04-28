var readings = document.getElementById('readings')
var tempReading = document.getElementById('temp-reading')
var orpReading = document.getElementById('orp-reading')
var phReading = document.getElementById('ph-reading')
var flowGood = document.getElementById('flow-good')
var lastFlowGood = document.getElementById('last-flow-good')
var fatalErrorField = document.getElementById('fatal-error-field')

function load() {
	var xhr = new XMLHttpRequest()
	xhr.open('GET', '/reading?t=' + Date.now())
	xhr.onreadystatechange = function () {
		if (xhr.readyState === XMLHttpRequest.DONE) {
			if (xhr.status === 200) {
				var body = JSON.parse(xhr.response)
				readings.className = body.accurate ? 'accurate-reading' : 'inaccurate-reading'
				tempReading.innerHTML = body.temp
				orpReading.innerHTML = body.orp
				phReading.innerHTML = body.ph
				flowGood.innerHTML = body.flowGood ? 'YES' : 'NO'
				flowGood.className = body.flowGood ? 'state-good' : 'state-bad'
				lastFlowGood.innerHTML = body.lastFlowGood
				fatalErrorField.innerHTML = body.fatalError
				fatalErrorField.className = body.fatalError === 'none' ? 'state-good' : 'state-bad'
			}
			setTimeout(load, 500)
		}
	}
	xhr.send()
}

load()
