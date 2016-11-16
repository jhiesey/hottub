var readings = document.getElementById('readings')
var tempReading = document.getElementById('temp-reading')
var orpReading = document.getElementById('orp-reading')
var phReading = document.getElementById('ph-reading')
var statusField = document.getElementById('status-field')

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
				statusField.innerHTML = body.status
			}
			setTimeout(load, 500)
		}
	}
	xhr.send()
}

load()
