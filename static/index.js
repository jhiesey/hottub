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
		}
	}
	xhr.send()
	setTimeout(load, 1000)
}

load()
