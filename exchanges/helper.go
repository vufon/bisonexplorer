package exchanges

import "strings"

func IsDCRBTCExchange(token string) bool {
	return strings.HasPrefix(token, "btc_") || token == "dcrdex"
}

func GetDCRBTCExchangeName(token string) string {
	if token == "dcrdex" {
		return token
	}
	tokenArr := strings.Split(token, "_")
	if len(tokenArr) < 2 {
		return token
	}
	return tokenArr[1]
}

func indexOf(slice []string, target string) int {
	for i, v := range slice {
		if v == target {
			return i
		}
	}
	return -1
}
