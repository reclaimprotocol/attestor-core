
type DunzoOrder = {
	state: string
	taskData: {
		taskProperties: {
			paymentInvoice: {
				totalAmount: {
					value: number
				}
			}
		}
	}
}

function deliveredCondition(order: DunzoOrder): boolean {
	return order.state === 'COMPLETED'
}

export default function getTopOrderValues(orderList: DunzoOrder [], condition, k = 1) {
	const result: number [] = []
	let count = 0

	for(const order of orderList) {
		if(condition(order)) {
			const orderVal = order.taskData?.taskProperties?.paymentInvoice?.totalAmount?.value
			result.push(orderVal)
			count++

			if(count === k) {
				break
			}
		}
	}

	return result
}


export {
	deliveredCondition,
}