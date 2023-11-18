 type InstaVerifierResponseTypeItem = {
  like_count: number
  clips_metadata: {
    music_info: {
      music_asset_info: {
        audio_cluster_id: string
      }
    }
  }
};
export type InstaVerifierResponseType = {
  items: Array<InstaVerifierResponseTypeItem>
  user: {
    full_name: string
    username: string
    is_verified: boolean
    profile_pic_url: string
  }
  status: string
};

export const isLikesInRange = (
	input: number,
	reference: number,
	percentage: number
) => {
	const lowerBound = reference - (reference * percentage) / 100
	const upperBound = reference + (reference * percentage) / 100

	return input >= lowerBound && input <= upperBound
}
