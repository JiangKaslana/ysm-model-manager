// [doc:architecture] ui-bone-select — 骨骼下拉选择模块
// addBoneSelectRow / isIkBone / buildBoneGroups（ADR-122 P3 拆分）
// 自 ui-rows.ts 剥离：与通用行控件（toggle/slider/mode）职责分离，
// 骨骼分组 + IK 标记为独立领域逻辑。

export interface BoneSelectOptions {
    /** 搜索框 placeholder，默认 '搜索骨骼' */
    searchPlaceholder?: string;
    testId?: string;
}

/** 已知 IK 骨骼名集合（IK 目标骨 + 链骨） */
const IK_BONE_NAMES = new Set([
    '左足IK',
    '右足IK',
    '左腕IK',
    '右腕IK',
    '左足首',
    '右足首',
    '左ひざ',
    '右ひざ',
    '左ひじ',
    '右ひじ',
]);

/** 判断骨骼是否为 IK 相关骨骼 */
export function isIkBone(boneName: string): boolean {
    return IK_BONE_NAMES.has(boneName) || boneName.endsWith('IK');
}

/** 已知 MMD 骨骼分组（按日文标准名匹配前缀；遍历顺序决定归属优先级） */
const KNOWN_BONE_GROUPS: Record<string, string[]> = {
    'センター/腰部': ['センター', 'グルーブ', '腰'],
    '上半身': ['上半身', '上半身2', '胸', '首', '頭'],
    '下半身': [
        '下半身',
        '左足',
        '右足',
        '左ひざ',
        '右ひざ',
        '左足首',
        '右足首',
        '左足IK',
        '右足IK',
    ],
    '左腕': ['左肩', '左腕', '左ひじ', '左手首'],
    '右腕': ['右肩', '右腕', '右ひじ', '右手首'],
    '左手': ['左親指', '左人指', '左中指', '左薬指', '左小指'],
    '右手': ['右親指', '右人指', '右中指', '右薬指', '右小指'],
};

/** 按类别分组骨骼名，未匹配的归入「その他」。空组被剔除。 */
export function buildBoneGroups(boneNames: readonly string[]): [string, string[]][] {
    const groups: Map<string, string[]> = new Map();
    for (const key of Object.keys(KNOWN_BONE_GROUPS)) {
        groups.set(key, []);
    }
    groups.set('その他', []);
    for (const name of boneNames) {
        let placed = false;
        for (const [groupName, prefixes] of Object.entries(KNOWN_BONE_GROUPS)) {
            if (prefixes.some((p) => name === p || name.startsWith(p))) {
                groups.get(groupName)!.push(name);
                placed = true;
                break;
            }
        }
        if (!placed) {
            groups.get('その他')!.push(name);
        }
    }
    const result: [string, string[]][] = [];
    for (const [groupName, boneList] of groups) {
        if (boneList.length > 0) {
            boneList.sort();
            result.push([groupName, boneList]);
        }
    }
    return result;
}

/**
 * 创建骨骼选择行：label + 搜索框 + 分组下拉（含 IK 标记）。
 * 替代 addModeRow 在上百骨骼上的误用，统一相机骨骼锁定 / 高级骨骼覆盖两处入口。
 * 返回 select 元素，便于调用方按需同步 value。
 */
export function addBoneSelectRow(
    container: HTMLElement,
    label: string,
    boneNames: readonly string[],
    currentName: string,
    onChange: (name: string) => void,
    opts?: BoneSelectOptions
): HTMLSelectElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'bone-select-row';
    if (opts?.testId) {
        wrapper.setAttribute('data-testid', opts.testId);
    }

    if (label) {
        const lbl = document.createElement('div');
        lbl.className = 'cs-label-sm';
        lbl.textContent = label;
        wrapper.appendChild(lbl);
    }

    const boneSearch = document.createElement('input');
    boneSearch.type = 'text';
    boneSearch.className = 'full-input';
    boneSearch.placeholder = opts?.searchPlaceholder ?? '搜索骨骼';
    wrapper.appendChild(boneSearch);

    const boneSelect = document.createElement('select');
    boneSelect.className = 'setting-select';

    const groups = buildBoneGroups(boneNames);
    for (const [groupLabel, names] of groups) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = groupLabel;
        for (const bn of names) {
            const opt = document.createElement('option');
            opt.value = bn;
            // IK 骨骼附加标记
            opt.textContent = isIkBone(bn) ? `${bn} (IK)` : bn;
            optGroup.appendChild(opt);
        }
        boneSelect.appendChild(optGroup);
    }
    boneSelect.value = currentName;
    boneSelect.addEventListener('change', () => {
        onChange(boneSelect.value);
    });
    // 搜索过滤：原生 select 不支持搜索，附加过滤输入框
    boneSearch.addEventListener('input', () => {
        const q = boneSearch.value.trim().toLowerCase();
        for (const g of Array.from(boneSelect.querySelectorAll('optgroup'))) {
            let visible = 0;
            for (const opt of Array.from(g.querySelectorAll('option'))) {
                const hit = !q || (opt.textContent ?? '').toLowerCase().includes(q);
                (opt as HTMLElement).style.display = hit ? '' : 'none';
                if (hit) {
                    visible++;
                }
            }
            (g as HTMLElement).style.display = visible > 0 ? '' : 'none';
        }
    });
    wrapper.appendChild(boneSelect);
    container.appendChild(wrapper);
    return boneSelect;
}