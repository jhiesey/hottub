
exports.makeStateMachine = ({ states, initialState, initialParams, onStateChange, flowState }) => {
	let started = false
	let currentStateName = null
	let currentStateTimer = null
	let onAsyncError = null
	let exitStateMachine = null
	let subState = null

	let onFlowGoodTriggered = false
	let onFlowBadTriggered = false

	let flowChangeHandler = null

	const stateMap = {}

	let userFunctions = null

	const mainPromise = new Promise((resolve, reject) => {
		onAsyncError = (error) => {
			if (flowChangeHandler) {
				flowChangeHandler.cancel()
			}

			reject(error)
		}

		exitStateMachine = (result) => {
			if (flowChangeHandler) {
				flowChangeHandler.cancel()
			}

			resolve(result)
		}
	})

	const setState = async (name, params) => {
		console.log('setState', name, params)
		let expectedStateName = currentStateName

		if (!started) {
			throw new Error('setState called before run')
		}

		if (name === currentStateName) {
			return; // Already in correct state
		}

		clearTimeout(currentStateTimer)
		currentStateTimer = null
		// Make sure these don't trigger during leave
		onFlowGoodTriggered = true
		onFlowBadTriggered = true

		const onLeave = stateMap[currentStateName]?.onLeave
		if (onLeave) {
			await onLeave(userFunctions, subState, name)
		}

		if (currentStateName !== expectedStateName) {
			return
		}

		if (!stateMap.hasOwnProperty(name)) {
			throw new Error(`Invalid setState call from state ${currentStateName} to ${name}`)
		}

		const previousStateName = currentStateName

		currentStateName = name
		expectedStateName = name
		subState = params // Default unless onEnter returns something different
		onFlowGoodTriggered = false
		onFlowBadTriggered = false

		if (onStateChange) {
			await onStateChange(currentStateName, previousStateName)
		}

		if (currentStateName !== expectedStateName) {
			return
		}

		const onEnter = stateMap[currentStateName].onEnter
		if (onEnter) {
			const newSubState = await onEnter(userFunctions, params, previousStateName)

			if (currentStateName !== expectedStateName) {
				return
			}

			// Optional; don't override default unless defined
			if (newSubState !== undefined) {
				subState = newSubState
			}
		}


		const hasFlow = await flowState.get()

		if (currentStateName !== expectedStateName) {
			return
		}

		if (hasFlow && stateMap[currentStateName].onFlowGood && !onFlowGoodTriggered) {
			onFlowGoodTriggered = true

			await stateMap[currentStateName].onFlowGood(userFunctions, subState)
		}

		if (currentStateName !== expectedStateName) {
			return
		}

		if (!stateMap[currentStateName]) {
			console.log(`BAD STATE 1: ${currentStateName}`)
		}
		if (!hasFlow && stateMap[currentStateName].onFlowBad && !onFlowBadTriggered) {
			onFlowBadTriggered = true

			await stateMap[currentStateName].onFlowBad(userFunctions, subState)
		}
	}

	flowChangeHandler = flowState.onChange((hasFlow) => {
		const handleChange = async () => {
			if (!started) {
				return
			}

			if (hasFlow && stateMap[currentStateName].onFlowGood && !onFlowGoodTriggered) {
				onFlowGoodTriggered = true

				await stateMap[currentStateName].onFlowGood(userFunctions, subState)
			}

			if (!stateMap[currentStateName]) {
				console.log(`BAD STATE 2: ${currentStateName}`)
			}
			if (!hasFlow && stateMap[currentStateName].onFlowBad && !onFlowBadTriggered) {
				onFlowBadTriggered = true

				await stateMap[currentStateName].onFlowBad(userFunctions, subState)
			}
		}

		handleChange().catch(onAsyncError)
	})

	const setTimer = (durationSeconds) => {
		console.log('setTimer', durationSeconds)
		if (typeof durationSeconds !== 'number') {
			throw new Error('setTimer called with non-number argument!')
		}
		const onTimer = stateMap[currentStateName].onTimer

		if (!onTimer) {
			throw new Error(`setTimer called on state ${currentStateName} but onTimer is not defined`)
		}

		if (currentStateTimer) {
			clearTimeout(currentStateTimer)
		}

		currentStateTimer = setTimeout(() => {
			const handleTimer = async () => {
				await onTimer(userFunctions, subState)
			}

			handleTimer().catch(onAsyncError)
		}, durationSeconds * 1000)
	}

	userFunctions = {
		setState,
		setTimer,
		exit: exitStateMachine
	}

	for (const [name, state] of Object.entries(states)) {
		const { onEnter, onLeave } = state

		stateMap[name] = {
			name,
			onEnter: onEnter ?? null,
			onLeave: onLeave ?? null
		}
	}

	for (const [name, state] of Object.entries(states)) {
		for (const method of ['onFlowGood', 'onFlowBad', 'onTimer']) {
			const stateMethod = state[method]

			let methodFunction = null
			if (typeof stateMethod === 'function') {
				methodFunction = stateMethod
			} else if (stateMethod != null) {
				throw new Error(`Invalid handler for ${method} of ${state}`)
			}

			stateMap[name][method] = methodFunction
		}
	}

	if (!stateMap.hasOwnProperty(initialState)) {
		throw new Error(`Invalid initial state: ${initialState}`)
	}

	return {
		run: async () => {
			if (started) {
				throw new Error(`run called when state machine already started`)
			}
			started = true

			await setState(initialState, initialParams)

			return mainPromise
		},
		setState,
		getState: () => currentStateName,
		getSubState: () => subState,
		exit: exitStateMachine
	}
}