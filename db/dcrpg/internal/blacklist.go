// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package internal

const (
	CreateBlackListTable = `
		CREATE TABLE IF NOT EXISTS black_list (
		agent TEXT,
		ip TEXT,
		note TEXT,
		CONSTRAINT agent_ip PRIMARY KEY (agent, ip)
	);`

	UpsertBlackList = `
		INSERT INTO black_list (agent, ip, note)
		VALUES ($1, $2, $3)
		ON CONFLICT (agent, ip)
		DO UPDATE SET
		note = $3
	;`

	CheckExistOnBlackList = `
		SELECT EXISTS (SELECT 1 FROM black_list WHERE agent = $1 AND ip = $2);
	;`
)
