export function convertNumbersToIntegers(object) {
	for(const key in object) {
		// check if the property is actually a property of the object
		// and not from its prototype chain
		if(object.hasOwnProperty(key)) {
			if(typeof object[key] === 'number') {
				// if the property value is a number, convert to integer
				object[key] = Math.floor(object[key])
			} else if(typeof object[key] === 'object') {
				// if the property value is an object, recursively process
				convertNumbersToIntegers(object[key])
			}
		}
	}
}