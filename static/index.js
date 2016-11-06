var tempReading = document.getElementById('temp-reading')
var orpReading = document.getElementById('orp-reading')
var phReading = document.getElementById('ph-reading')

function load() {
	var xhr = new XMLHttpRequest()
	xhr.open('GET', '/reading')
	xhr.onreadystatechange = function () {
		if (xhr.readyState === XMLHttpRequest.DONE) {
			if (xhr.status === 200) {
				var body = JSON.parse(xhr.response)
				tempReading.innerHTML = body.temp
				orpReading.innerHTML = body.orp
				phReading.innerHTML = body.ph
			}
			setTimeout(load, 500)
		}
	}
	xhr.send()
}

load()

var runButton = document.getElementById('run-button')
var durationField = document.getElementById('duration')
var pumpButtons = document.getElementsByName('pump')

runButton.addEventListener('click', function () {
	var body = {
		duration: parseFloat(durationField.value)
	}
	for (var i = 0; i < pumpButtons.length; i++) {
		if (pumpButtons[i].checked) {
			body.pump = pumpButtons[i].value
			break
		}
	}

	var xhr = new XMLHttpRequest()
	xhr.open('POST', '/runpump')
	xhr.setRequestHeader('Content-Type', 'application/json')
	xhr.onreadystatechange = function () {
		if (xhr.readyState === XMLHttpRequest.DONE) {
			var body = null
			if (xhr.status === 200) {
				body = JSON.parse(xhr.response)
			}
			if (!body || !body.success) {
				alert('Failed to run pump!')
			}
		}
	}
	xhr.send(JSON.stringify(body))
})
