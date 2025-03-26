package internal

import (
	"fmt"
	"strings"
)

const (
	CreateAtomicSwapTableV0 = `CREATE TABLE IF NOT EXISTS swaps (
		contract_tx TEXT,
		contract_time INT8,
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
		group_tx TEXT,
		CONSTRAINT spend_tx_in PRIMARY KEY (spend_tx, spend_vin)
	);`

	CreateAtomicSwapTable = CreateAtomicSwapTableV0

	InsertContractSpend = `INSERT INTO swaps (contract_tx, contract_time, contract_vout, spend_tx, spend_vin, spend_height,
		p2sh_addr, value, secret_hash, secret, lock_time, is_refund, group_tx)
	VALUES ($1, $2, $3, $4, $5,
		$6, $7, $8, $9, $10, $11, $12, $13) 
	ON CONFLICT (spend_tx, spend_vin)
		DO UPDATE SET spend_height = $6;`

	UpdateTargetToken = `UPDATE swaps SET target_token = $1 WHERE contract_tx = $2;`

	IndexSwapsOnHeightV0 = `CREATE INDEX idx_swaps_height ON swaps (spend_height);`
	IndexSwapsOnHeight   = IndexSwapsOnHeightV0
	DeindexSwapsOnHeight = `DROP INDEX idx_swaps_height;`

	SelectAtomicSwapsContractGroupWithFilter = `SELECT gr1.group_tx, gr1.target, gr1.refund FROM (SELECT group_tx, MAX(target_token) AS target, (ARRAY_AGG(is_refund))[1] AS refund FROM swaps %s 
		GROUP BY group_tx ORDER BY MAX(contract_time) DESC) AS gr1 %s
		LIMIT $1 OFFSET $2;`

	SelectMultichainSwapInfoRows = `SELECT * FROM %s_swaps WHERE contract_tx = $1 OR spend_tx = $1 ORDER BY lock_time DESC;`

	SelectAtomicSwapsContractGroupWithSearchFilter = `SELECT gr1.group_tx, gr1.target, gr1.refund FROM (SELECT group_tx, MAX(target_token) AS target, (ARRAY_AGG(is_refund))[1] AS refund FROM swaps WHERE (contract_tx = $1 OR spend_tx = $1 
		OR contract_tx IN (SELECT decred_contract_tx FROM btc_swaps WHERE contract_tx = $1 OR spend_tx = $1)
		OR contract_tx IN (SELECT decred_contract_tx FROM ltc_swaps WHERE contract_tx = $1 OR spend_tx = $1))
		 %s 
 		GROUP BY group_tx ORDER BY MAX(contract_time) DESC) AS gr1 %s
		LIMIT $2 OFFSET $3;`

	SelectAtomicSpendsByContractTx = `SELECT spend_tx, spend_vin, spend_height, value, lock_time FROM swaps WHERE contract_tx = $1 AND group_tx = $2 ORDER BY lock_time;`

	SelectContractListByGroupTx = `SELECT ctx.contract_tx, MAX(ctx.contract_time), SUM(value) FROM (SELECT contract_tx, contract_time, value FROM swaps 
		WHERE group_tx = $1 ORDER BY contract_time,lock_time DESC) AS ctx GROUP BY ctx.contract_tx;`

	SelectSwapGroupTx                   = `SELECT group_tx FROM swaps WHERE contract_tx = $1 OR spend_tx = $2 LIMIT 1`
	CountAtomicSwapsRowWithFilter       = `SELECT COUNT(1) FROM (SELECT group_tx, MAX(target_token) AS target FROM swaps %s GROUP BY group_tx) AS gr1 %s;`
	CountAtomicSwapsRowWithSearchFilter = `SELECT COUNT(1) FROM (SELECT group_tx, MAX(target_token) AS target FROM swaps 
	WHERE (contract_tx = $1 OR spend_tx = $1 
	OR contract_tx IN (SELECT decred_contract_tx FROM btc_swaps WHERE contract_tx = $1 OR spend_tx = $1)
	OR contract_tx IN (SELECT decred_contract_tx FROM ltc_swaps WHERE contract_tx = $1 OR spend_tx = $1))
	%s 
 	GROUP BY group_tx) AS gr1 %s;`

	SelectDecredMinTime       = `SELECT COALESCE(MIN(lock_time), 0) AS min_time FROM swaps`
	CountAtomicSwapsRow       = `SELECT COUNT(1) FROM (SELECT group_tx FROM swaps GROUP BY group_tx) AS ctx;`
	CountRefundAtomicSwapsRow = `SELECT COUNT(*) FROM (SELECT group_tx FROM swaps WHERE is_refund GROUP BY group_tx) AS ctx;`
	SelectTotalTradingAmount  = `SELECT SUM(value) FROM swaps`
	SelectOldestContractTime  = `SELECT MIN(contract_time) FROM swaps;`

	SelectExistSwapBySecretHash = `SELECT group_tx FROM swaps WHERE secret_hash = $1 LIMIT 1`
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

	SelectMultichainSwapType = `SELECT * FROM (
    SELECT 
        CASE 
            WHEN bs.contract_tx = $1
            THEN 'contract'
            WHEN bs.spend_tx = $1
            THEN CASE WHEN 
				EXISTS (
                    SELECT 1 FROM swaps sw 
                    WHERE sw.is_refund = TRUE 
                    AND sw.group_tx = bs.decred_contract_tx
                ) 
                THEN 'refund' 
                ELSE 'redemption' 
            END
            ELSE NULL
        END AS swaptype
    FROM %s_swaps bs) t 
	WHERE t.swaptype IS NOT NULL;`

	SelectVoutIndexOfContract = `SELECT contract_vout FROM %s_swaps WHERE contract_tx = $1;`
	SelectVinIndexOfRedeem    = `SELECT spend_vin FROM %s_swaps WHERE spend_tx = $1;`

	selectSwapsTxcount = `SELECT %s as timestamp,
		COUNT(*) FILTER (WHERE is_refund = FALSE) AS redeemed_count,
		COUNT(*) FILTER (WHERE is_refund = TRUE) AS refund_count
		FROM swaps
		GROUP BY timestamp
		ORDER BY timestamp;`

	CheckSwapsType = `SELECT 
		contract_tx = $1 AS is_contract,
		spend_tx = $1 AS is_target,
		is_refund = TRUE AS refund 
	FROM swaps 
		WHERE contract_tx = $1 OR spend_tx = $1 
	LIMIT 1;`
	SelectContractTxsFromSpendTx = `SELECT ctx.group_tx, ctx.target
		 FROM (SELECT group_tx, (ARRAY_AGG(target_token))[1] AS target, MAX(contract_time) AS contime 
		 FROM swaps WHERE spend_tx = $1 GROUP BY group_tx ORDER BY contime DESC) AS ctx;`
	SelectTargetTokenOfContract                     = `SELECT target_token, group_tx FROM swaps WHERE contract_tx = $1 LIMIT 1;`
	SelectGroupTxBySpendTx                          = `SELECT target_token, group_tx FROM swaps WHERE spend_tx = $1 LIMIT 1;`
	SelectDecredContractTxsFromMultichainSpendTx    = `SELECT decred_contract_tx FROM %s_swaps WHERE spend_tx = $1 GROUP BY decred_contract_tx LIMIT 1;`
	SelectDecredContractTxsFromMultichainContractTx = `SELECT decred_contract_tx FROM %s_swaps WHERE contract_tx = $1 GROUP BY decred_contract_tx LIMIT 1;`
	CheckSwapIsRefund                               = `SELECT is_refund FROM swaps WHERE group_tx = $1 LIMIT 1;`
)

func MakeSelectAtomicSwapsContractGroupWithFilter(pair, status string) string {
	return MakeSelectWithFilter(SelectAtomicSwapsContractGroupWithFilter, pair, status, false)
}

func MakeSelectAtomicSwapsContractGroupWithSearchFilter(pair, status string) string {
	return MakeSelectWithFilter(SelectAtomicSwapsContractGroupWithSearchFilter, pair, status, true)
}

func MakeCountAtomicSwapsRowWithFilter(pair, status string) string {
	return MakeSelectWithFilter(CountAtomicSwapsRowWithFilter, pair, status, false)
}

func MakeCountAtomicSwapsRowWithSearchFilter(pair, status string) string {
	return MakeSelectWithFilter(CountAtomicSwapsRowWithSearchFilter, pair, status, true)
}

func MakeSelectWithFilter(input, pair, status string, withoutWhere bool) string {
	queries := make([]string, 0)
	pairCond := ""
	if pair == "unknown" {
		pairCond = "WHERE gr1.target IS NULL OR gr1.target = ''"
	} else if pair != "" && pair != "all" {
		pairCond = fmt.Sprintf("WHERE gr1.target = '%s'", pair)
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
	query := ""
	if len(queries) > 0 {
		var cond string
		if !withoutWhere {
			cond = "WHERE "
		} else {
			cond = " AND "
		}
		query = cond + strings.Join(queries, " AND ")
	}
	return fmt.Sprintf(input, query, pairCond)
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
