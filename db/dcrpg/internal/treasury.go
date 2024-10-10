// Copyright (c) 2021, The Decred developers
// See LICENSE for details.

package internal

// These queries relate primarily to the "treasury" table.
const (
	CreateTreasuryTable = `CREATE TABLE IF NOT EXISTS treasury (
		tx_hash TEXT,
		tx_type INT4,
		value INT8,
		block_hash TEXT,
		block_height INT8,
		block_time TIMESTAMPTZ NOT NULL,
		is_mainchain BOOLEAN
	);`

	// monthly legacy address summary table
	CreateTreasurySummaryTable = `CREATE TABLE IF NOT EXISTS treasury_summary (
			id SERIAL PRIMARY KEY,
			time TIMESTAMPTZ NOT NULL,
			spent_value BIGINT,
			received_value BIGINT,
			tadd_value BIGINT,
			tbase_revert_index INT8,
			spend_revert_index INT8,
			saved BOOLEAN
		);`

	//insert to legacy  address summary table
	InsertTreasurySummaryRow = `INSERT INTO treasury_summary (time, spent_value, received_value, tadd_value, saved, tbase_revert_index, spend_revert_index)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`

	//select first from summary table
	SelectTreasurySummaryRows = `SELECT * FROM treasury_summary ORDER BY time`

	// select only data from summary table
	SelectTreasurySummaryDataRows     = `SELECT time,spent_value,received_value,tadd_value FROM treasury_summary ORDER BY time DESC`
	SelectTreasurySummaryRowsByYearly = `SELECT time,spent_value FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1 ORDER BY time DESC`
	SelectTreasurySummaryYearlyData   = `SELECT SUM(spent_value),SUM(received_value),SUM(tadd_value) FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1`
	SelectTreasurySummaryMonthlyData  = `SELECT time,spent_value,received_value,tadd_value FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1 AND EXTRACT(MONTH FROM time AT TIME ZONE 'UTC') = $2`

	SelectSpendRowIndexByMonth = `SELECT spend_revert_index FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1 AND EXTRACT(MONTH FROM time AT TIME ZONE 'UTC') = $2`
	SelectSpendRowIndexByYear  = `SELECT MAX(spend_revert_index) FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1`
	SelectTBaseRowIndexByMonth = `SELECT tbase_revert_index FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1 AND EXTRACT(MONTH FROM time AT TIME ZONE 'UTC') = $2`
	SelectTBaseRowIndexByYear  = `SELECT MAX(tbase_revert_index) FROM treasury_summary WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1`
	// get timerange of treasury summary
	SelectTreasuryTimeRange = `SELECT MIN(time), MAX(time) FROM treasury_summary`

	SelectTreasurySummaryDataByMonth = `SELECT time,spent_value,received_value FROM treasury_summary 
WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1 AND EXTRACT(MONTH FROM time AT TIME ZONE 'UTC') = $2`

	SelectTreasurySummaryDataByYear = `SELECT DATE_TRUNC('year',time) as tx_year,SUM(spent_value) as spent_value,SUM(received_value) as received_value FROM treasury_summary
WHERE EXTRACT(YEAR FROM time AT TIME ZONE 'UTC') = $1 GROUP BY tx_year;`

	// update spent and total value
	UpdateTreasurySummaryByTotalAndSpent = `UPDATE treasury_summary SET spent_value = $1, received_value = $2, tadd_value = $3, saved = $4, spend_revert_index = $5, tbase_revert_index = $6 WHERE id = $7`

	IndexTreasuryOnTxHash   = `CREATE UNIQUE INDEX ` + IndexOfTreasuryTableOnTxHash + ` ON treasury(tx_hash, block_hash);`
	DeindexTreasuryOnTxHash = `DROP INDEX ` + IndexOfTreasuryTableOnTxHash + ` CASCADE;`

	IndexTreasuryOnBlockHeight   = `CREATE INDEX ` + IndexOfTreasuryTableOnHeight + ` ON treasury(block_height DESC);`
	DeindexTreasuryOnBlockHeight = `DROP INDEX ` + IndexOfTreasuryTableOnHeight + ` CASCADE;`

	UpdateTreasuryMainchainByBlock = `UPDATE treasury
		SET is_mainchain=$1
		WHERE block_hash=$2;`

	// InsertTreasuryRow inserts a new treasury row without checking for unique
	// index conflicts. This should only be used before the unique indexes are
	// created or there may be constraint violations (errors).
	InsertTreasuryRow = `INSERT INTO treasury (
		tx_hash, tx_type, value, block_hash, block_height, block_time, is_mainchain)
	VALUES ($1, $2, $3,	$4, $5, $6, $7) `

	// UpsertTreasuryRow is an upsert (insert or update on conflict), returning
	// the inserted/updated treasury row id. is_mainchain is updated as this
	// might be a reorganization.
	UpsertTreasuryRow = InsertTreasuryRow + `ON CONFLICT (tx_hash, block_hash)
		DO UPDATE SET is_mainchain = $7;`

	// InsertTreasuryRowOnConflictDoNothing allows an INSERT with a DO NOTHING
	// on conflict with a treasury tnx's unique tx index.
	InsertTreasuryRowOnConflictDoNothing = InsertTreasuryRow + `ON CONFLICT (tx_hash, block_hash)
		DO NOTHING;`

	SelectTreasuryTxns = `SELECT * FROM treasury 
		WHERE is_mainchain
		ORDER BY block_height DESC
		LIMIT $1 OFFSET $2;`

	SelectTreasuryTxnsYear = `SELECT * FROM treasury 
		WHERE is_mainchain AND EXTRACT(YEAR FROM block_time AT TIME ZONE 'UTC') = $1
		ORDER BY block_height DESC
		LIMIT $2 OFFSET $3;`

	SelectTreasuryTxnsYearMonth = `SELECT * FROM treasury 
		WHERE is_mainchain AND EXTRACT(YEAR FROM block_time AT TIME ZONE 'UTC') = $1 AND EXTRACT(MONTH FROM block_time AT TIME ZONE 'UTC') = $2
		ORDER BY block_height DESC
		LIMIT $3 OFFSET $4;`

	SelectTreasuryOldestTime = `SELECT block_time FROM treasury 
		WHERE is_mainchain ORDER BY block_time LIMIT 1;`

	SelectTypedTreasuryTxnsAll = `SELECT * FROM treasury 
		WHERE is_mainchain
			AND tx_type = $1
		ORDER BY block_height DESC;`

	SelectTypedTreasuryTxns = `SELECT * FROM treasury 
		WHERE is_mainchain
			AND tx_type = $1
		ORDER BY block_height DESC
		LIMIT $2 OFFSET $3;`

	SelectTypedTreasuryTxnsYear = `SELECT * FROM treasury 
		WHERE is_mainchain
			AND tx_type = $1 AND EXTRACT(YEAR FROM block_time AT TIME ZONE 'UTC') = $2
		ORDER BY block_height DESC
		LIMIT $3 OFFSET $4;`

	SelectTypedTreasuryTxnsYearMonth = `SELECT * FROM treasury 
		WHERE is_mainchain
			AND tx_type = $1 AND EXTRACT(YEAR FROM block_time AT TIME ZONE 'UTC') = $2 AND EXTRACT(MONTH FROM block_time AT TIME ZONE 'UTC') = $3
		ORDER BY block_height DESC
		LIMIT $4 OFFSET $5;`

	SelectTreasuryBalance = `SELECT
		tx_type,
		COUNT(CASE WHEN block_height <= $1 THEN 1 END),
		COUNT(1),
		SUM(CASE WHEN block_height <= $1 THEN value ELSE 0 END),
		SUM(value)
		FROM treasury
		WHERE is_mainchain
		GROUP BY tx_type;`

	SelectTreasuryBalanceYear = `SELECT
		tx_type,
		COUNT(CASE WHEN block_height <= $1 THEN 1 END),
		COUNT(1),
		SUM(CASE WHEN block_height <= $1 THEN value ELSE 0 END),
		SUM(value)
		FROM treasury
		WHERE is_mainchain AND EXTRACT(YEAR FROM block_time AT TIME ZONE 'UTC') = $2
		GROUP BY tx_type;`

	SelectTreasuryBalanceYearMonth = `SELECT
		tx_type,
		COUNT(CASE WHEN block_height <= $1 THEN 1 END),
		COUNT(1),
		SUM(CASE WHEN block_height <= $1 THEN value ELSE 0 END),
		SUM(value)
		FROM treasury
		WHERE is_mainchain AND EXTRACT(YEAR FROM block_time AT TIME ZONE 'UTC') = $2 AND EXTRACT(MONTH FROM block_time AT TIME ZONE 'UTC') = $3
		GROUP BY tx_type;`

	selectBinnedIO = `SELECT %s as timestamp,
		SUM(CASE WHEN (tx_type=4 OR tx_type=6) THEN value ELSE 0 END) as received,
		SUM(CASE WHEN tx_type=5 THEN -value ELSE 0 END) as sent
		FROM treasury
		GROUP BY timestamp
		ORDER BY timestamp;`

	SelectTreasurySummaryByMonth = `SELECT ts1.month, coalesce(ts1.invalue, 0) as invalue , coalesce(ts2.outvalue, 0) as outvalue
	FROM (SELECT SUM(value) as invalue, DATE_TRUNC('month',block_time) as month FROM treasury WHERE tx_type IN (4,6) GROUP BY month) ts1
	FULL OUTER JOIN 
	(SELECT SUM(value) as outvalue, DATE_TRUNC('month',block_time) as month FROM treasury WHERE tx_type = 5 GROUP BY month) ts2 
	ON ts1.month = ts2.month 
	WHERE EXTRACT(YEAR FROM ts1.month AT TIME ZONE 'UTC') = $1 AND EXTRACT(MONTH FROM ts1.month AT TIME ZONE 'UTC') = $2
	ORDER BY ts1.month DESC;`

	SelectTreasurySummaryByYear = `SELECT ts1.year, coalesce(ts1.invalue, 0) as invalue , coalesce(ts2.outvalue, 0) as outvalue
	FROM (SELECT SUM(value) as invalue, DATE_TRUNC('year',block_time) as year FROM treasury WHERE tx_type IN (4,6) GROUP BY year) ts1
	FULL OUTER JOIN 
	(SELECT SUM(value) as outvalue, DATE_TRUNC('year',block_time) as year FROM treasury WHERE tx_type = 5 GROUP BY year) ts2 
	ON ts1.year = ts2.year
	WHERE EXTRACT(YEAR FROM ts1.year AT TIME ZONE 'UTC') = $1;`

	SelectYearlyTreasuryGroupByMonth = `SELECT ts1.month , coalesce(ts2.outvalue, 0) as outvalue
	FROM (SELECT SUM(value) as invalue, DATE_TRUNC('month',block_time) as month,DATE_TRUNC('year',block_time) as year  FROM treasury WHERE tx_type IN (4,6) GROUP BY month, year) ts1
	FULL OUTER JOIN 
	(SELECT SUM(value) as outvalue, DATE_TRUNC('month',block_time) as month FROM treasury WHERE tx_type = 5 GROUP BY month) ts2 
	ON ts1.month = ts2.month
	WHERE EXTRACT(YEAR FROM ts1.year AT TIME ZONE 'UTC') = $1;`

	SelectTreasurySummaryGroupByMonth = `SELECT ts1.month, coalesce(ts1.invalue, 0) as invalue , coalesce(ts2.outvalue, 0) as outvalue
	FROM (SELECT SUM(value) as invalue, DATE_TRUNC('month',block_time) as month FROM treasury WHERE tx_type IN (4,6) GROUP BY month) ts1
	FULL OUTER JOIN 
	(SELECT SUM(value) as outvalue, DATE_TRUNC('month',block_time) as month FROM treasury WHERE tx_type = 5 GROUP BY month) ts2 
	ON ts1.month = ts2.month ORDER BY ts1.month DESC;`
	SelectOldestTreasuryTime = `SELECT block_time FROM treasury ORDER BY block_time LIMIT 1;`
	CountTBaseRow            = `SELECT COUNT(*)
		FROM treasury WHERE is_mainchain AND tx_type = 6`

	SelectTreasuryTBaseRowCountByMonth = `SELECT DATE_TRUNC('month', block_time AT TIME ZONE 'UTC') as month ,COUNT(*) as row_num 
		FROM treasury WHERE is_mainchain AND tx_type = 6 GROUP BY month ORDER BY month;`

	CountSpendRow = `SELECT COUNT(*)
		FROM treasury WHERE is_mainchain AND tx_type = 5`

	SelectTreasurySpendRowCountByMonth = `SELECT DATE_TRUNC('month', block_time AT TIME ZONE 'UTC') as month ,COUNT(*) as row_num 
		FROM treasury WHERE is_mainchain AND tx_type = 5 GROUP BY month ORDER BY month;`
	SelectTreasuryFirstRowFromOldest = `SELECT block_time FROM treasury WHERE is_mainchain 
		ORDER BY block_time, tx_hash ASC LIMIT 1`
	SelectTreasuryRowsByPeriod = `SELECT *
		FROM treasury WHERE is_mainchain AND block_time >= $1 AND block_time <= $2 AND block_height <= $3
		ORDER BY block_time, tx_hash ASC;`
)

// MakeTreasuryInsertStatement returns the appropriate treasury insert statement
// for the desired conflict checking and handling behavior. For checked=false,
// no ON CONFLICT checks will be performed, and the value of updateOnConflict is
// ignored. This should only be used prior to creating a unique index as these
// constraints will cause an errors if an inserted row violates a constraint.
// For updateOnConflict=true, an upsert statement will be provided that UPDATEs
// the conflicting row. For updateOnConflict=false, the statement will either
// insert or do nothing, and return the inserted (new) or conflicting
// (unmodified) row id.
func MakeTreasuryInsertStatement(checked, updateOnConflict bool) string {
	if !checked {
		return InsertTreasuryRow
	}
	if updateOnConflict {
		return UpsertTreasuryRow
	}
	return InsertTreasuryRowOnConflictDoNothing
}

func MakeSelectTreasuryIOStatement(group string) string {
	return formatGroupingQuery(selectBinnedIO, group, "block_time")
}
