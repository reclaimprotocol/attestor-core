import BinanceAgeVerification from './binance-age-verification/binance-dob'
import bybitBalance from './bybit/bybit-balance'
import bybitSpotPnl from './bybit/bybit-spot-pnl'
import chessRating from './chess/chess-rating'
import chessUser from './chess/chess-user'
import ebayUser from './ebay/ebay-user'
import irsAddress from './irs/irs-address'
import irsName from './irs/irs-name'
import kaggleUsername from './kaggle/kaggle-username'
import lichessUsername from './lichess/lichess-username'
import mediumFollowersCount from './medium/medium-follower-count'
import nameBrightDomainList from './namebright/namebright-domains'
import nameCheapDomainList from './namecheap/namecheap-domains'
import razorpaySalary from './razorpay/razorpay-salary'
import razorpayTitle from './razorpay/razorpay-title'
import SoundcloudUsername from './soundcloud/soundcloud-username'
import spotifyAccountType from './spotify/spotify-account-type'
import spotifyEmail from './spotify/spotify-email'
import spotifyUserName from './spotify/spotify-username'
import steamId from './steam/steam-id'
import stravaLastRun from './strava/strava-last-run'
import swiggyUser from './swiggy-equal/swiggy-equal'
import uberRides from './uber/uber-rides'
import UidaiAadhaarAddress from './uidai/uidai-address'
import UidaiAadhaarDOB from './uidai/uidai-dob'
import UidaiAadhaar from './uidai/uidai-name'
import UidaiAadhaarPhone from './uidai/uidai-phone'
import UidaiAadhaarState from './uidai/uidai-stateName'
import UidaiAadhaarUid from './uidai/uidai-uid'
import venmoUser from './venmo/venmo-id'
import venmoTransaction from './venmo/venmo-transaction'
import zomatoOrders from './zomato/zomato-order-count'
import binanceAssetBalance from './binance-asset-balance'
import blindUser from './blind-user'
import CodeforcesRating from './codeforces-rating'
import coindcxBalance from './coindcx-balance'
import coinswitchBalance from './coinswitch-balance'
import DevfolioHackathonsCount from './devfolio-hackathon-participated'
import { dunzoLastOrder } from './dunzo'
import facebookAccountCreationDate from './facebook-account-creation-date'
import facebookFriendsCount from './facebook-friends-count'
import flickrUser from './flickr-user'
import makeGithubProvider from './github-claim'
import goDaddyLogin from './godaddy-user'
import goibibo from './goibibo'
import googleLogin from './google-login'
import GrowwStocksCount from './groww-stock-balance'
import hackerEarthUser from './hackerearth-user'
import hackerRankUsername from './hackerrank-username'
import httpProvider from './http-provider'
import instagramUserWeekPost from './instagram-posts'
import instagramUser from './instagram-user'
import letterboxdUser from './letterboxd-user'
import loomUser from './loom-user-id'
import { mastodonUser } from './mastodon'
import notionUsername from './notion-username'
import oneMg from './oneMg'
import outlookLogin from './outlook-login'
import panCardNumber from './pancard'
import ProtonMail from './proton-mail'
import quoraUser from './quora-user'
import scholarGoogle from './scholar-citations'
import spotifyPremium from './spotify-premium'
import swiggyTotalOrder from './swiggy-min-order'
import TinderMatchCount from './tinder-match-count'
import tumblrFollower from './tumblr-follower'
import { twitterFollowersCount, twitterUsername } from './twitter'
import wikipediaUser from './wikipedia-user'
import YCombinatorLogin from './ycombinator-login'
import zohoEmail from './zoho-email'
import zomatoOrdersEqual from './zomato-equal'


export const providers = {
	'google-login': googleLogin,
	'yc-login': YCombinatorLogin,
	'outlook-login': outlookLogin,
	'codeforces-rating': CodeforcesRating,
	'dunzo-last-order': dunzoLastOrder,
	'tinder-match-count': TinderMatchCount,
	http: httpProvider,
	'github-commits': makeGithubProvider<'github-commits'>(),
	'github-issues': makeGithubProvider<'github-issues'>(),
	'github-pull-requests': makeGithubProvider<'github-pull-requests'>(),
	'mastodon-user': mastodonUser,
	'spotify-premium': spotifyPremium,
	'spotify-account-type': spotifyAccountType,
	'spotify-username': spotifyUserName,
	'spotify-email': spotifyEmail,
	'tumblr-follower': tumblrFollower,
	'swiggy-total-count': swiggyTotalOrder,
	'wikipedia-user': wikipediaUser,
	'facebook-friends-count': facebookFriendsCount,
	'facebook-account-creation-date': facebookAccountCreationDate,
	'binance-asset-balance': binanceAssetBalance,
	'ebay-user': ebayUser,
	'flickr-user': flickrUser,
	'instagram-user': instagramUser,
	'instagram-user-week-posts': instagramUserWeekPost,
	'blind-user': blindUser,
	'chess-user': chessUser,
	'bybit-balance': bybitBalance,
	'groww-stock-balance': GrowwStocksCount,
	'devfolio-hackathon-count': DevfolioHackathonsCount,
	'quora-user': quoraUser,
	'notion-username': notionUsername,
	'medium-followers-count': mediumFollowersCount,
	'lichess-username': lichessUsername,
	'proton-mail': ProtonMail,
	'soundcloud-username': SoundcloudUsername,
	'letterboxd-user': letterboxdUser,
	'coinswitch-balance': coinswitchBalance,
	'zomato-order-count': zomatoOrders,
	'loom-user-id': loomUser,
	'chess-rating': chessRating,
	'coindcx-balance': coindcxBalance,
	'hackerearth-user': hackerEarthUser,
	'hackerrank-username': hackerRankUsername,
	'uidai-aadhar': UidaiAadhaar,
	'godaddy-login': goDaddyLogin,
	'uidai-phone': UidaiAadhaarPhone,
	'uidai-state': UidaiAadhaarState,
	'uidai-uid': UidaiAadhaarUid,
	'uidai-dob': UidaiAadhaarDOB,
	'uidai-address': UidaiAadhaarAddress,
	'twitter-followers-count': twitterFollowersCount,
	'twitter-username': twitterUsername,
	'irs-name': irsName,
	'irs-address': irsAddress,
	'bybit-spot-pnl': bybitSpotPnl,
	'zoho-email': zohoEmail,
	'venmo-id': venmoUser,
	'venmo-transaction': venmoTransaction,
	goibibo: goibibo,
	'swiggy-equal': swiggyUser,
	'one-mg': oneMg,
	'kaggle-username': kaggleUsername,
	'namebright-domains': nameBrightDomainList,
	'namecheap-domains': nameCheapDomainList,
	'strava-last-run': stravaLastRun,
	'uber-rides': uberRides,
	'scholar-citations': scholarGoogle,
	'pancard-number': panCardNumber,
	'binance-dob': BinanceAgeVerification,
	'steam': steamId,
	'zomato-equal': zomatoOrdersEqual,
	'razorpay-title': razorpayTitle,
	'razorpay-salary': razorpaySalary
}

export type ProviderName = keyof typeof providers

type Provider<E extends ProviderName> = (typeof providers)[E]

export type ProviderParams<E extends ProviderName> = Parameters<
    Provider<E>['assertValidProviderReceipt']
>[1]

export type ProviderSecretParams<E extends ProviderName> = Parameters<
    Provider<E>['createRequest']
>[0]
