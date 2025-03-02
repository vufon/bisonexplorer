package internal

const (
	CreateLtcAtomicSwapTableV0 = `CREATE TABLE IF NOT EXISTS ltc_swaps (
		contract_tx TEXT,
		decred_spend_tx TEXT,
		decred_spend_height INT8,
		contract_vout INT4,
		spend_tx TEXT,
		spend_vin INT4,
		spend_height INT8,
		p2sh_addr TEXT,
		value INT8,
		secret_hash BYTEA,
		secret BYTEA,        -- NULL for refund
		lock_time INT8,
		CONSTRAINT spend_ltc_tx_in PRIMARY KEY (spend_tx, spend_vin)
	);`

	CreateLtcAtomicSwapTable = CreateLtcAtomicSwapTableV0

	InsertLtcContractSpend = `INSERT INTO ltc_swaps (contract_tx, decred_spend_tx, decred_spend_height, contract_vout, spend_tx, spend_vin, spend_height,
		p2sh_addr, value, secret_hash, secret, lock_time)
	VALUES ($1, $2, $3, $4, $5,
		$6, $7, $8, $9, $10, $11, $12) 
	ON CONFLICT (spend_tx, spend_vin)
		DO UPDATE SET spend_height = $7
		RETURNING contract_tx;`

	IndexLtcSwapsOnHeightV0 = `CREATE INDEX idx_ltc_waps_height ON ltc_swaps (spend_height);`
	IndexLtcSwapsOnHeight   = IndexLtcSwapsOnHeightV0
	DeindexLtcSwapsOnHeight = `DROP INDEX idx_ltc_waps_height;`

	SelectAtomicLtcSwaps = `SELECT * FROM ltc_swaps 
		ORDER BY lock_time DESC
		LIMIT $1 OFFSET $2;`

	SelectAtomicLtcSwapsWithDcrSpendTx = `SELECT * FROM ltc_swaps WHERE decred_spend_tx = $1 AND secret_hash = $2 LIMIT 1`

	CountAtomicLtcSwapsRow = `SELECT COUNT(*)
		FROM ltc_swaps`
	SelectDecredMinHeightFromLtcSwaps = `SELECT COALESCE(MIN(decred_spend_height), 0) AS min_decred_height FROM ltc_swaps`
	SelectLtcMinHeight                = `SELECT COALESCE(MIN(spend_height), 0) AS min_height FROM ltc_swaps`
	SelectDecredMaxHeightFromLtcSwaps = `SELECT COALESCE(MAX(decred_spend_height), 0) AS max_decred_height FROM ltc_swaps`
)
