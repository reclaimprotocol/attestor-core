# What does Reclaim solve?

Right now, most of the world's data is locked up in web2 servers and there is no trustless way to use this data on-chain or anywhere else. Here is where our protocol comes in.

1. Let's say you want to prove you have access to a certain gmail account to everyone. The only way you can do that is by either:
	- sharing a screenshot of your gmail account (of course, this is easily spoofed)
	- share your password (A bit obvious why this wouldn't be a good option)
2. Let's look at google's people API for a second now.
	- Its [get people API](https://developers.google.com/people/api/rest/v1/people/get) lets one fetch their email address via an access token
	- Imagine, if you could make this API request and prove to everyone that you made this request to Google's servers -- you could prove, without a doubt, that you own a certain email address.
	- Example of a request & response:
		- request:
		``` http
		GET /v1/people/me?personFields=emailAddresses HTTP/1.1
		Host: people.googleapis.com
		Connection: close
		Content-Length: 0
		Authorization: Bearer {secret-token}


		```
		- response:
		``` http
		HTTP/1.1 200 OK
		Content-length: 382
		X-xss-protection: 0
		Content-location: https://people.googleapis.com/v1/people/me?personFields=emailAddresses
		X-content-type-options: nosniff
		Transfer-encoding: chunked
		Content-type: application/json; charset=UTF-8
		{
			"resourceName": "people/12323123123", 
			"emailAddresses": [
				{
					"value": "abcd@creatoros.co", 
					"metadata": {
						"source": {
						"type": "DOMAIN_PROFILE", 
						"id": "12323123123"
						}, 
						"verified": true, 
						"primary": true, 
						"sourcePrimary": true
					}
				}
			], 
			"etag": "%EgUBCS43PhoEAQIFBw=="
		}
		```
	
3. The Reclaim protocol allows you to fire an API request to gmail proxied through a "witness" node that observes the traffic sent & received. 
4. The protocol enables you to hide certain packets from the witness (which contain your password or API secret -- in the eg. above it'll be "{secret-token}").
5. Once the witness observes that the response from Google's servers matches the response you claim to have received, it'll sign your "claim" to the email address.
6. This signed claim can then be used to prove to anyone that you have access to the email address without revealing your password or API secret.
7. Thus, trustlessly prove you've access to an email address. Of course, one has to still trust the witness to not collude with you -- but we solve this by decentralising the witness network.

Read the whitepaper [here](TODO)
