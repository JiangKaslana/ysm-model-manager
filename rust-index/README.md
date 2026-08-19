# rust-index

有状态模型索引层，位于无状态 `rust-core` 扫描器之上。

每次刷新把新的 `ScanReport` 和上一版快照比较，只产生 `added / updated / removed`。未变化文件会保留已经计算出的哈希，因此 UI 刷新不需要重复进行内容哈希。

当前实现仍以整树快速扫描作为变更发现来源；下一阶段会接入文件系统 watcher，把 watcher 事件转成同一套索引变更语义。
