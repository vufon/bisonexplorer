// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

package internal

// These queries relate primarily to the "24hblocks" table.
const (
	Create24hBlocksTable = `CREATE TABLE IF NOT EXISTS blocks24h (
		id SERIAL8 PRIMARY KEY,
		chain_type TEXT,
		block_hash TEXT,
		block_height INT8,
		block_time TIMESTAMPTZ,
		spent INT8,
		sent INT8,
		fees INT8,
		num_tx INT4,
		num_vin INT4,
		num_vout INT4
	);`

	insert24hBlockRow = `INSERT INTO blocks24h (
		chain_type, block_hash, block_height,block_time,spent,
		sent,fees,num_tx,num_vin,num_vout)
	VALUES (
		$1, $2, $3, $4,
		$5, $6, $7, $8, $9, $10) `

	Insert24hBlocksRow = insert24hBlockRow + `RETURNING id;`

	CheckExist24Blocks      = `SELECT EXISTS(SELECT 1 FROM blocks24h WHERE chain_type=$1 AND block_height=$2);`
	DeleteInvalidBlocks     = `DELETE FROM blocks24h WHERE block_time < (SELECT NOW() - INTERVAL '1 DAY');`
	Select24hMetricsSummary = `SELECT COUNT(*),SUM(b24h.spent),SUM(b24h.sent),SUM(b24h.fees),SUM(b24h.num_tx),SUM(b24h.num_vin),SUM(b24h.num_vout)
						FROM (SELECT DISTINCT spent,sent,fees,num_tx,num_vin,num_vout FROM blocks24h WHERE chain_type=$1) AS b24h;`
)
