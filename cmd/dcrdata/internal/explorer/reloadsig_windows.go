//go:build windows

package explorer

// UseSIGToReloadTemplates wraps (*explorerUI).UseSIGToReloadTemplates for
// non-Windows systems, where there are actually signals.
func (exp *ExplorerUI) UseSIGToReloadTemplates() {
	log.Info("Signals unsupported on windows")
}
