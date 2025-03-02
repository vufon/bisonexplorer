package internal

const (
	CreateBtcAtomicSwapTableV0 = `CREATE TABLE IF NOT EXISTS btc_swaps (
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
		CONSTRAINT spend_btc_tx_in PRIMARY KEY (spend_tx, spend_vin)
	);`

	CreateBtcAtomicSwapTable = CreateBtcAtomicSwapTableV0

	InsertBtcContractSpend = `INSERT INTO btc_swaps (contract_tx, decred_spend_tx, decred_spend_height, contract_vout, spend_tx, spend_vin, spend_height,
		p2sh_addr, value, secret_hash, secret, lock_time)
	VALUES ($1, $2, $3, $4, $5,
		$6, $7, $8, $9, $10, $11, $12) 
	ON CONFLICT (spend_tx, spend_vin)
		DO UPDATE SET spend_height = $7
		RETURNING contract_tx;`

	IndexBtcSwapsOnHeightV0 = `CREATE INDEX idx_btc_waps_height ON btc_swaps (spend_height);`
	IndexBtcSwapsOnHeight   = IndexBtcSwapsOnHeightV0
	DeindexBtcSwapsOnHeight = `DROP INDEX idx_btc_waps_height;`

	SelectAtomicBtcSwaps = `SELECT * FROM btc_swaps 
		ORDER BY lock_time DESC
		LIMIT $1 OFFSET $2;`

	SelectAtomicBtcSwapsWithDcrSpendTx = `SELECT * FROM btc_swaps WHERE decred_spend_tx = $1 AND secret_hash = $2 LIMIT 1`

	CountAtomicBtcSwapsRow = `SELECT COUNT(*)
		FROM btc_swaps`
	SelectDecredMinHeight = `SELECT COALESCE(MIN(decred_spend_height), 0) AS min_decred_height FROM btc_swaps`
	SelectBtcMinHeight    = `SELECT COALESCE(MIN(spend_height), 0) AS min_height FROM btc_swaps`
	SelectDecredMaxHeight = `SELECT COALESCE(MAX(decred_spend_height), 0) AS max_decred_height FROM btc_swaps`
)
