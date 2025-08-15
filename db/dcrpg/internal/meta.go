// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package internal

import "fmt"

// These queries relate primarily to the "meta" table.
const (
	CreateMetaTable = `CREATE TABLE IF NOT EXISTS meta (
		net_name TEXT,
		currency_net INT8 PRIMARY KEY,
		best_block_height INT8,
		best_block_hash TEXT,
		compatibility_version INT4,
		schema_version INT4,
		maintenance_version INT4,
		ibd_complete BOOLEAN,
		btc_block_height INT8 DEFAULT 0,
		ltc_block_height INT8 DEFAULT 0,
		btc_tx_count INT8 DEFAULT 0,
		ltc_tx_count INT8 DEFAULT 0
	);`

	UpdateMultichainTxCount = `UPDATE meta SET %s_block_height = $1, %s_tx_count = %s_tx_count + $2`

	GetCurrentMultichainTxCountHeight = `SELECT %s_block_height FROM meta LIMIT 1`

	GetCurrentMultichainTxCount = `SELECT %s_tx_count FROM meta LIMIT 1`

	InsertMetaRow = `INSERT INTO meta (net_name, currency_net, best_block_height, best_block_hash,
		compatibility_version, schema_version, maintenance_version,
		ibd_complete)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`

	SelectMetaDBVersions = `SELECT
		compatibility_version,
		schema_version,
		maintenance_version
	FROM meta;`

	SelectMetaDBBestBlock = `SELECT
		best_block_height,
		best_block_hash
	FROM meta;`

	SetMetaDBBestBlock = `UPDATE meta
		SET best_block_height = $1, best_block_hash = $2;`

	SelectMetaDBIbdComplete = `SELECT ibd_complete FROM meta;`

	SetMetaDBIbdComplete = `UPDATE meta
		SET ibd_complete = $1;`

	SetDBSchemaVersion = `UPDATE meta
		SET schema_version = $1;`

	SetDBMaintenanceVersion = `UPDATE meta
		SET maintenance_version = $1;`
)

func CreateMultichainTxCountUpdateQuery(chainType string) string {
	return fmt.Sprintf(UpdateMultichainTxCount, chainType, chainType, chainType)
}

func GetMultichainTxCountHeightQuery(chainType string) string {
	return fmt.Sprintf(GetCurrentMultichainTxCountHeight, chainType)
}

func GetMultichainTxCountQuery(chainType string) string {
	return fmt.Sprintf(GetCurrentMultichainTxCount, chainType)
}
