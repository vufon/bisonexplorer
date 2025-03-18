package internal

const (
	CreateBtcAtomicSwapTableV0 = `CREATE TABLE IF NOT EXISTS btc_swaps (
		contract_tx TEXT,
		decred_contract_tx TEXT,
		contract_vout INT4,
		spend_tx TEXT,
		spend_vin INT4,
		spend_height INT8,
		p2sh_addr TEXT,
		value INT8,
		secret_hash BYTEA,
		secret BYTEA,
		lock_time INT8,
		CONSTRAINT spend_btc_tx_in PRIMARY KEY (spend_tx, spend_vin)
	);`

	CreateBtcAtomicSwapTable = CreateBtcAtomicSwapTableV0

	InsertBtcContractSpend = `INSERT INTO btc_swaps (contract_tx, decred_contract_tx, contract_vout, spend_tx, spend_vin, spend_height,
		p2sh_addr, value, secret_hash, secret, lock_time)
	VALUES ($1, $2, $3, $4, $5,
		$6, $7, $8, $9, $10, $11) 
	ON CONFLICT (spend_tx, spend_vin)
		DO UPDATE SET spend_height = $6
		RETURNING contract_tx;`

	IndexBtcSwapsOnHeightV0 = `CREATE INDEX idx_btc_waps_height ON btc_swaps (spend_height);`
	IndexBtcSwapsOnHeight   = IndexBtcSwapsOnHeightV0
	DeindexBtcSwapsOnHeight = `DROP INDEX idx_btc_waps_height;`

	SelectAtomicBtcSwapsWithDcrContractTx = `SELECT * FROM btc_swaps WHERE decred_contract_tx = $1 ORDER BY lock_time DESC;`
	SelectBTCContractListByGroupTx        = `SELECT ctx.contract_tx, SUM(value) FROM (SELECT contract_tx, value FROM btc_swaps 
		WHERE decred_contract_tx = $1 ORDER BY lock_time DESC) AS ctx GROUP BY ctx.contract_tx;`
	SelectBTCAtomicSpendsByContractTx = `SELECT spend_tx, spend_vin, spend_height, value, lock_time FROM btc_swaps WHERE contract_tx = $1 ORDER BY lock_time;`
)
