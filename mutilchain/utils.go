// Copyright (c) 2013-2015 The btcsuite developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package mutilchain

import (
	"math"
	"strings"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/ltcsuite/ltcd/ltcutil"
)

const (
	TYPEDCR = "dcr"
	TYPELTC = "ltc"
	TYPEBTC = "btc"
)

func IsEmpty(x interface{}) bool {
	switch value := x.(type) {
	case string:
		return value == ""
	case int32:
		return value == 0
	case int:
		return value == 0
	case uint32:
		return value == 0
	case uint64:
		return value == 0
	case int64:
		return value == 0
	case float64:
		return value == 0
	case bool:
		return false
	default:
		return true
	}
}

func IsDisabledChain(disabledList string, chainType string) bool {
	if IsEmpty(disabledList) {
		return false
	}
	disabledArr := strings.Split(disabledList, ",")
	for _, disabledItem := range disabledArr {
		if IsEmpty(disabledItem) {
			continue
		}
		if strings.TrimSpace(disabledItem) == chainType {
			return true
		}
	}
	return false
}

func GetBTCCurrentBlockReward(reductionInterval, currentBlockHeight int32) int64 {
	numReduceToNextHalving := currentBlockHeight / reductionInterval
	coinValue := BTCStartBlockReward / math.Pow(2, float64(numReduceToNextHalving))
	btcAmount, vErr := btcutil.NewAmount(coinValue)
	if vErr != nil {
		return 0
	}
	return int64(btcAmount)
}

func GetLTCCurrentBlockReward(reductionInterval, currentBlockHeight int32) int64 {
	numReduceToNextHalving := currentBlockHeight / reductionInterval
	coinValue := LTCStartBlockReward / math.Pow(2, float64(numReduceToNextHalving))
	ltcAmount, vErr := ltcutil.NewAmount(coinValue)
	if vErr != nil {
		return 0
	}
	return int64(ltcAmount)
}

func GetBTCNextBlockReward(reductionInterval, currentBlockHeight int32) int64 {
	numReduceToNextHalving := currentBlockHeight/reductionInterval + 1
	coinValue := BTCStartBlockReward / math.Pow(2, float64(numReduceToNextHalving))
	btcAmount, vErr := btcutil.NewAmount(coinValue)
	if vErr != nil {
		return 0
	}
	return int64(btcAmount)
}

func GetLTCNextBlockReward(reductionInterval, currentBlockHeight int32) int64 {
	numReduceToNextHalving := currentBlockHeight/reductionInterval + 1
	coinValue := LTCStartBlockReward / math.Pow(2, float64(numReduceToNextHalving))
	ltcAmount, vErr := ltcutil.NewAmount(coinValue)
	if vErr != nil {
		return 0
	}
	return int64(ltcAmount)
}

func GetNextBlockReward(chainType string, reductionInterval, currentBlockHeight int32) int64 {
	switch chainType {
	case TYPEBTC:
		return GetBTCNextBlockReward(reductionInterval, currentBlockHeight)
	case TYPELTC:
		return GetLTCNextBlockReward(reductionInterval, currentBlockHeight)
	default:
		return 0
	}
}

func GetCurrentBlockReward(chainType string, reductionInterval, currentBlockHeight int32) int64 {
	switch chainType {
	case TYPEBTC:
		return GetBTCCurrentBlockReward(reductionInterval, currentBlockHeight)
	case TYPELTC:
		return GetLTCCurrentBlockReward(reductionInterval, currentBlockHeight)
	default:
		return 0
	}
}
