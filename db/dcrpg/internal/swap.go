package internal

import (
	"fmt"
	"strings"
)

const (
	CreateAtomicSwapTableV0 = `CREATE TABLE IF NOT EXISTS swaps (
		contract_tx TEXT,
		contract_vout INT4,
		spend_tx TEXT,
		spend_vin INT4,
		spend_height INT8,
		p2sh_addr TEXT,
		value INT8,
		secret_hash BYTEA,
		secret BYTEA,        -- NULL for refund
		lock_time INT8,
		target_token TEXT,
		is_refund BOOLEAN DEFAULT false,
		CONSTRAINT spend_tx_in PRIMARY KEY (spend_tx, spend_vin)
	);`

	CreateAtomicSwapTable = CreateAtomicSwapTableV0

	InsertContractSpend = `INSERT INTO swaps (contract_tx, contract_vout, spend_tx, spend_vin, spend_height,
		p2sh_addr, value, secret_hash, secret, lock_time, is_refund)
	VALUES ($1, $2, $3, $4, $5,
		$6, $7, $8, $9, $10, $11) 
	ON CONFLICT (spend_tx, spend_vin)
		DO UPDATE SET spend_height = $5;`

	UpdateTargetToken = `UPDATE swaps SET target_token = $1 WHERE contract_tx = $2;`

	IndexSwapsOnHeightV0 = `CREATE INDEX idx_swaps_height ON swaps (spend_height);`
	IndexSwapsOnHeight   = IndexSwapsOnHeightV0
	DeindexSwapsOnHeight = `DROP INDEX idx_swaps_height;`

	SelectAtomicSwaps = `SELECT * FROM swaps 
		ORDER BY lock_time DESC
		LIMIT $1 OFFSET $2;`

	SelectAtomicSwapsWithFilter = `SELECT * FROM swaps %s
		ORDER BY lock_time DESC
		LIMIT $1 OFFSET $2;`
	CountAtomicSwapsRowWithFilter = `SELECT COUNT(*) FROM swaps %s`

	SelectDecredMinTime = `SELECT COALESCE(MIN(lock_time), 0) AS min_time FROM swaps`
	CountAtomicSwapsRow = `SELECT COUNT(*)
		FROM swaps`
	CountRefundAtomicSwapsRow          = `SELECT COUNT(*) FROM swaps WHERE is_refund`
	SelectTotalTradingAmount           = `SELECT SUM(value) FROM swaps`
	SelectAtomicSwapsTimeWithMinHeight = `SELECT lock_time FROM swaps WHERE spend_height > $1
		ORDER BY lock_time`
	SelectDecredMinContractTx   = `SELECT contract_tx FROM swaps WHERE spend_height > $1 ORDER BY lock_time LIMIT 1`
	SelectDecredMaxLockTime     = `SELECT lock_time FROM swaps WHERE spend_height > $1 ORDER BY lock_time DESC LIMIT 1`
	SelectExistSwapBySecretHash = `SELECT contract_tx FROM swaps WHERE secret_hash = $1 LIMIT 1`
	Select24hSwapSummary        = `SELECT SUM(value), 
		COUNT(*) FILTER (WHERE is_refund = FALSE) AS redeemed_count,
		COUNT(*) FILTER (WHERE is_refund = TRUE) AS refund_count
		FROM swaps 
		WHERE TO_TIMESTAMP(lock_time) >= NOW() - INTERVAL '24 hours'`

	selectSwapsAmount = `SELECT %s as timestamp,
		SUM(CASE WHEN is_refund = FALSE THEN value ELSE 0 END) as redeemed,
		SUM(CASE WHEN is_refund = TRUE THEN value ELSE 0 END) as refund
		FROM swaps
		GROUP BY timestamp
		ORDER BY timestamp;`

	selectSwapsTxcount = `SELECT %s as timestamp,
		COUNT(*) FILTER (WHERE is_refund = FALSE) AS redeemed_count,
		COUNT(*) FILTER (WHERE is_refund = TRUE) AS refund_count
		FROM swaps
		GROUP BY timestamp
		ORDER BY timestamp;`
)

func MakeSelectAtomicSwapsWithFilter(pair, status string) string {
	return MakeSelectWithFilter(SelectAtomicSwapsWithFilter, pair, status)
}

func MakeCountAtomicSwapsRowWithFilter(pair, status string) string {
	return MakeSelectWithFilter(CountAtomicSwapsRowWithFilter, pair, status)
}

func MakeSelectWithFilter(input, pair, status string) string {
	queries := make([]string, 0)
	if pair != "" && pair != "all" {
		queries = append(queries, fmt.Sprintf("target_token = '%s'", pair))
	}
	if status != "" && status != "all" {
		switch status {
		case "refund":
			queries = append(queries, "is_refund = true")
		case "redemption":
			queries = append(queries, "is_refund = false")
		default:
		}
	}
	if len(queries) == 0 {
		return fmt.Sprintf(input, "")
	}
	return fmt.Sprintf(input, "WHERE "+strings.Join(queries, " AND "))
}

func MakeSelectSwapsAmount(group string) string {
	return formatSwapsGroupingQuery(selectSwapsAmount, group, "lock_time")
}

func MakeSelectSwapsTxcount(group string) string {
	return formatSwapsGroupingQuery(selectSwapsTxcount, group, "lock_time")
}

func formatSwapsGroupingQuery(mainQuery, group, column string) string {
	if group == "all" {
		return fmt.Sprintf(mainQuery, column)
	}
	subQuery := fmt.Sprintf("date_trunc('%s', TO_TIMESTAMP(%s))", group, column)
	return fmt.Sprintf(mainQuery, subQuery)
}
