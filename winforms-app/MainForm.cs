using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace ProjectArchiveManager
{
    public class MainForm : Form
    {
        List<Project> projects;
        Settings settings;
        int selectedIndex = -1;
        EpisodeInfo currentResolved;
        List<ImportService.ScanResult> scanResults;
        TextBox txtSearch, txtLocalDir, txtNasDir, txtKeyword;
        TreeView tvProjects;
        Button btnAdd, btnEdit, btnDelete, btnBatchImport, btnOpenLocal, btnOpenNas, btnCopyPath, btnCopyMsg;
        Button btnRefreshPending, btnCheckAll, btnUncheckAll, btnCopySelected;
        Button btnModifyRefresh, btnModifyCheckAll, btnModifyCopy;
        Label lblDetectLocal, lblDetectNas, lblDetectSummary, lblModifyInfo, lblModifySummary;
        CheckedListBox clbPending, clbModify;
        StatusStrip statusStrip;
        ToolStripStatusLabel lblStatus;

        public MainForm()
        {
            Text = "项目档案管理器"; Size = new Size(1050, 750); MinimumSize = new Size(900, 600);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 9f);
            LoadData(); BuildUI(); RefreshProjectTree();
        }

        void LoadData() { projects = ProjectService.LoadProjects(); settings = ProjectService.LoadSettings(); foreach (var p in projects) if (string.IsNullOrEmpty(p.Status)) p.Status = "active"; }

        void BuildUI()
        {
            var split = new SplitContainer { Dock = DockStyle.Fill, SplitterDistance = 240, Panel1MinSize = 180 }; Controls.Add(split);
            BuildLeftPanel(split.Panel1); BuildRightPanel(split.Panel2);
            statusStrip = new StatusStrip(); lblStatus = new ToolStripStatusLabel("就绪"); statusStrip.Items.Add(lblStatus); Controls.Add(statusStrip);
        }

        void BuildLeftPanel(Panel panel)
        {
            panel.Padding = new Padding(4);
            txtSearch = new TextBox { Dock = DockStyle.Top, Height = 26 }; txtSearch.TextChanged += (s, e) => RefreshProjectTree();
            tvProjects = new TreeView { Dock = DockStyle.Fill, HideSelection = false, FullRowSelect = true };
            tvProjects.AfterSelect += (s, e) => { if (e.Node != null && e.Node.Tag is int) SelectProject((int)e.Node.Tag); };
            var btnPanel = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(0, 4, 0, 0) };
            btnAdd = new Button { Text = "+ 新建", Width = 60 }; btnAdd.Click += (s, e) => ShowProjectDialog(-1);
            btnEdit = new Button { Text = "编辑", Width = 55 }; btnEdit.Click += (s, e) => { if (selectedIndex >= 0) ShowProjectDialog(selectedIndex); };
            btnDelete = new Button { Text = "删除", Width = 55 }; btnDelete.Click += (s, e) => DeleteProject();
            btnBatchImport = new Button { Text = "批量导入", Width = 70 }; btnBatchImport.Click += (s, e) => ShowBatchImportDialog();
            btnPanel.Controls.AddRange(new Control[] { btnAdd, btnEdit, btnDelete, btnBatchImport });
            panel.Controls.Add(tvProjects); panel.Controls.Add(btnPanel); panel.Controls.Add(txtSearch);
        }

        void BuildRightPanel(Panel panel)
        {
            panel.AutoScroll = true; panel.Padding = new Padding(10); int y = 4;
            var kwPanel = new FlowLayoutPanel { Location = new Point(0, y), AutoSize = true };
            kwPanel.Controls.Add(new Label { Text = "识别关键字:", AutoSize = true, Padding = new Padding(0, 4, 0, 0) });
            txtKeyword = new TextBox { Width = 140, Text = settings.Keyword };
            var btnApplyKw = new Button { Text = "应用并扫描", AutoSize = true };
            btnApplyKw.Click += (s, ev) => { settings.Keyword = txtKeyword.Text.Trim(); ProjectService.SaveSettings(settings); RefreshDetail(); };
            kwPanel.Controls.Add(txtKeyword); kwPanel.Controls.Add(btnApplyKw); panel.Controls.Add(kwPanel);
            y += 30;

            var grpDir = new GroupBox { Text = "项目目录", Location = new Point(0, y), Size = new Size(panel.Width - 20, 70) };
            txtLocalDir = new TextBox { Location = new Point(100, 16), Width = grpDir.Width - 110, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = SystemColors.Control };
            txtNasDir = new TextBox { Location = new Point(100, 40), Width = grpDir.Width - 110, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = SystemColors.Control };
            grpDir.Controls.Add(new Label { Text = "本地根目录:", Location = new Point(10, 16), AutoSize = true });
            grpDir.Controls.Add(txtLocalDir); grpDir.Controls.Add(new Label { Text = "NAS 根目录:", Location = new Point(10, 40), AutoSize = true });
            grpDir.Controls.Add(txtNasDir); panel.Controls.Add(grpDir); y += 74;

            var grpDetect = new GroupBox { Text = "关键词目录检测", Location = new Point(0, y), Size = new Size(panel.Width - 20, 80) };
            lblDetectLocal = new Label { Location = new Point(10, 18), AutoSize = true, ForeColor = SystemColors.GrayText, Text = "未检测" };
            lblDetectNas = new Label { Location = new Point(10, 38), AutoSize = true, ForeColor = SystemColors.GrayText, Text = "未检测" };
            lblDetectSummary = new Label { Location = new Point(10, 56), AutoSize = true, Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Bold) };
            grpDetect.Controls.Add(lblDetectLocal); grpDetect.Controls.Add(lblDetectNas); grpDetect.Controls.Add(lblDetectSummary);
            panel.Controls.Add(grpDetect); y += 84;

            var actPanel = new FlowLayoutPanel { Location = new Point(0, y), AutoSize = true };
            btnOpenLocal = new Button { Text = "打开本地", AutoSize = true }; btnOpenLocal.Click += (s, e) => { var p = CurrentProject(); if (p != null) OpenExplorer(currentResolved != null && currentResolved.LocalExists ? currentResolved.LocalEpDir : p.LocalDir); };
            btnOpenNas = new Button { Text = "打开NAS", AutoSize = true }; btnOpenNas.Click += (s, e) => { var p = CurrentProject(); if (p != null) OpenExplorer(currentResolved != null && currentResolved.NasExists ? currentResolved.NasEpDir : p.NasDir); };
            btnCopyPath = new Button { Text = "复制NAS路径", AutoSize = true }; btnCopyPath.Click += (s, e) => { var p = CurrentProject(); if (p != null) CopyText(currentResolved != null ? currentResolved.NasEpDir : p.NasDir); };
            btnCopyMsg = new Button { Text = "复制交付信息", AutoSize = true }; btnCopyMsg.Click += (s, e) => CopyMsg();
            actPanel.Controls.AddRange(new Control[] { btnOpenLocal, btnOpenNas, btnCopyPath, btnCopyMsg });
            panel.Controls.Add(actPanel); y += 36;

            var grpPending = new GroupBox { Text = "待交付文件（本地有，NAS无）", Location = new Point(0, y), Size = new Size(panel.Width - 20, 200) };
            clbPending = new CheckedListBox { Location = new Point(5, 16), Size = new Size(grpPending.Width - 10, 120), CheckOnClick = true };
            var pBtns = new FlowLayoutPanel { Location = new Point(5, 140), AutoSize = true };
            btnRefreshPending = new Button { Text = "刷新", AutoSize = true }; btnRefreshPending.Click += (s, e) => RefreshPending();
            btnCheckAll = new Button { Text = "全选", AutoSize = true }; btnCheckAll.Click += (s, e) => { for (int i = 0; i < clbPending.Items.Count; i++) clbPending.SetItemChecked(i, true); };
            btnUncheckAll = new Button { Text = "取消全选", AutoSize = true }; btnUncheckAll.Click += (s, e) => { for (int i = 0; i < clbPending.Items.Count; i++) clbPending.SetItemChecked(i, false); };
            btnCopySelected = new Button { Text = "复制选中到NAS", AutoSize = true, BackColor = Color.FromArgb(220, 235, 255) }; btnCopySelected.Click += (s, e) => CopyPending();
            pBtns.Controls.AddRange(new Control[] { btnRefreshPending, btnCheckAll, btnUncheckAll, btnCopySelected });
            grpPending.Controls.Add(clbPending); grpPending.Controls.Add(pBtns); panel.Controls.Add(grpPending); y += 204;

            var grpModify = new GroupBox { Text = "上映单集版 - 修改交付", Location = new Point(0, y), Size = new Size(panel.Width - 20, 180) };
            lblModifyInfo = new Label { Location = new Point(5, 16), AutoSize = true, ForeColor = SystemColors.GrayText, Text = "选择项目后自动检测" };
            lblModifySummary = new Label { Location = new Point(5, 34), AutoSize = true };
            clbModify = new CheckedListBox { Location = new Point(5, 52), Size = new Size(grpModify.Width - 10, 80), CheckOnClick = true };
            var mBtns = new FlowLayoutPanel { Location = new Point(5, 136), AutoSize = true };
            btnModifyRefresh = new Button { Text = "刷新", AutoSize = true }; btnModifyRefresh.Click += (s, e) => RefreshModify();
            btnModifyCheckAll = new Button { Text = "全选", AutoSize = true }; btnModifyCheckAll.Click += (s, e) => { for (int i = 0; i < clbModify.Items.Count; i++) clbModify.SetItemChecked(i, true); };
            btnModifyCopy = new Button { Text = "复制选中批次到NAS", AutoSize = true, BackColor = Color.FromArgb(220, 235, 255) }; btnModifyCopy.Click += (s, e) => CopyModifyBatches();
            mBtns.Controls.AddRange(new Control[] { btnModifyRefresh, btnModifyCheckAll, btnModifyCopy });
            grpModify.Controls.Add(lblModifyInfo); grpModify.Controls.Add(lblModifySummary); grpModify.Controls.Add(clbModify); grpModify.Controls.Add(mBtns);
            panel.Controls.Add(grpModify);
        }

        Project CurrentProject() { return selectedIndex >= 0 && selectedIndex < projects.Count ? projects[selectedIndex] : null; }

        void RefreshProjectTree()
        {
            tvProjects.Nodes.Clear(); var search = txtSearch.Text.Trim().ToLower();
            var activeItems = new List<Tuple<Project, int>>(); var doneItems = new List<Tuple<Project, int>>();
            for (int i = 0; i < projects.Count; i++) { var p = projects[i]; if (!string.IsNullOrEmpty(search) && !p.Name.ToLower().Contains(search)) continue; if (p.Status == "done") doneItems.Add(Tuple.Create(p, i)); else activeItems.Add(Tuple.Create(p, i)); }
            var an = new TreeNode("进行中 (" + activeItems.Count + ")") { Tag = -1, ForeColor = Color.Gray };
            foreach (var a in activeItems) { var n = new TreeNode(a.Item1.Name) { Tag = a.Item2 }; if (a.Item2 == selectedIndex) { n.BackColor = SystemColors.Highlight; n.ForeColor = SystemColors.HighlightText; } an.Nodes.Add(n); }
            tvProjects.Nodes.Add(an);
            var dn = new TreeNode("已完成 (" + doneItems.Count + ")") { Tag = -1, ForeColor = Color.Gray };
            foreach (var d in doneItems) dn.Nodes.Add(new TreeNode(d.Item1.Name) { Tag = d.Item2, ForeColor = Color.Gray });
            tvProjects.Nodes.Add(dn); an.Expand(); dn.Expand();
        }

        void SelectProject(int idx) { selectedIndex = idx; currentResolved = null; RefreshProjectTree(); RefreshDetail(); RefreshModify(); }

        void DeleteProject() { if (selectedIndex < 0) return; var p = projects[selectedIndex]; if (MessageBox.Show("确定删除「" + p.Name + "」？", "确认", MessageBoxButtons.YesNo) != DialogResult.Yes) return; projects.RemoveAt(selectedIndex); ProjectService.SaveProjects(projects); if (selectedIndex >= projects.Count) selectedIndex = projects.Count - 1; RefreshProjectTree(); if (selectedIndex >= 0) SelectProject(selectedIndex); }

        void RefreshDetail()
        {
            var p = CurrentProject(); if (p == null) return;
            txtLocalDir.Text = p.LocalDir; txtNasDir.Text = p.NasDir;
            lblDetectLocal.Text = "扫描中..."; lblDetectNas.Text = "扫描中..."; lblDetectSummary.Text = ""; Application.DoEvents();
            currentResolved = FileService.ResolveEpisodeDirs(p, settings.Keyword);
            if (currentResolved.RelPath == null) { var m = "未找到含\"" + settings.Keyword + "\"的子目录"; lblDetectLocal.Text = m; lblDetectNas.Text = m; }
            else { lblDetectLocal.Text = currentResolved.LocalEpDir + " [" + (currentResolved.LocalExists ? currentResolved.LocalCount + "个" : "不存在") + "]"; lblDetectLocal.ForeColor = currentResolved.LocalExists ? Color.Green : Color.Red; lblDetectNas.Text = currentResolved.NasEpDir + " [" + (currentResolved.NasExists ? currentResolved.NasCount + "个" : "不存在") + "]"; lblDetectNas.ForeColor = currentResolved.NasExists ? Color.Green : SystemColors.GrayText; int d = currentResolved.LocalCount - currentResolved.NasCount; if (d > 0) { lblDetectSummary.Text = "本地比NAS多" + d + "个文件"; lblDetectSummary.ForeColor = Color.DarkOrange; } else if (currentResolved.LocalExists && currentResolved.NasExists) { lblDetectSummary.Text = "文件一致"; lblDetectSummary.ForeColor = Color.Green; } }
            RefreshPending();
        }

        void RefreshPending() { clbPending.Items.Clear(); if (currentResolved == null || !currentResolved.LocalExists) return; var fs = FileService.GetPendingFiles(currentResolved.LocalEpDir, currentResolved.NasEpDir); foreach (var f in fs) clbPending.Items.Add(f, true); lblStatus.Text = "待交付 " + fs.Count + " 个文件"; }

        void CopyPending()
        {
            if (currentResolved == null) return; var its = new List<string>(); foreach (var it in clbPending.CheckedItems) its.Add(it.ToString());
            if (its.Count == 0) { MessageBox.Show("请先勾选"); return; }
            int ok = 0; foreach (var f in its) { try { File.Copy(Path.Combine(currentResolved.LocalEpDir, f), Path.Combine(currentResolved.NasEpDir, f), true); ok++; } catch { } }
            MessageBox.Show("完成：" + ok + " 成功"); RefreshDetail();
        }

        void RefreshModify()
        {
            clbModify.Items.Clear(); lblModifyInfo.Text = "检测中..."; var p = CurrentProject(); if (p == null) { lblModifyInfo.Text = "请选择项目"; return; }
            string kw = "上映单集版"; string rel = FileService.FindKeywordDir(p.LocalDir, kw) ?? FileService.FindKeywordDir(p.NasDir, kw);
            if (rel == null) { lblModifyInfo.Text = "未找到\"" + kw + "\"目录"; return; }
            string lk = Path.Combine(p.LocalDir, rel), nk = Path.Combine(p.NasDir, rel);
            lblModifyInfo.Text = "本地: " + lk + "\nNAS: " + nk;
            if (!Directory.Exists(lk)) { lblModifySummary.Text = "本地目录不存在"; return; }
            var ds = Directory.GetDirectories(lk).Select(Path.GetFileName).ToList(); ds.Sort((a, b) => b.CompareTo(a)); int nc = 0;
            foreach (var d in ds) { bool ne = Directory.Exists(Path.Combine(nk, d)); int lc = FileService.CountFilesRecursive(Path.Combine(lk, d)); clbModify.Items.Add(d + " (" + lc + "个) " + (ne ? "[已交付]" : "[待交付]"), !ne); if (!ne) nc++; }
            lblModifySummary.Text = nc > 0 ? nc + " 个批次待交付" : "全部已交付"; lblModifySummary.ForeColor = nc > 0 ? Color.DarkOrange : Color.Green;
        }

        void CopyModifyBatches()
        {
            var p = CurrentProject(); if (p == null) return; string kw = "上映单集版"; string rel = FileService.FindKeywordDir(p.LocalDir, kw) ?? FileService.FindKeywordDir(p.NasDir, kw); if (rel == null) return;
            string lk = Path.Combine(p.LocalDir, rel), nk = Path.Combine(p.NasDir, rel);
            var ns = new List<string>(); for (int i = 0; i < clbModify.Items.Count; i++) if (clbModify.GetItemChecked(i)) ns.Add(clbModify.Items[i].ToString().Split(' ')[0]);
            if (ns.Count == 0) { MessageBox.Show("请先勾选"); return; }
            int ok = 0, fl = 0; foreach (var n in ns) { try { FileService.CopyDirectoryRecursive(Path.Combine(lk, n), Path.Combine(nk, n)); ok++; } catch { fl++; } }
            MessageBox.Show("完成：" + ok + " 成功，" + fl + " 失败"); RefreshModify();
        }

        void OpenExplorer(string path) { if (!string.IsNullOrEmpty(path) && Directory.Exists(path)) Process.Start("explorer.exe", path); }
        void CopyText(string t) { if (!string.IsNullOrEmpty(t)) { Clipboard.SetText(t); lblStatus.Text = "已复制"; } }
        void CopyMsg() { var p = CurrentProject(); if (p == null) return; string path = currentResolved != null ? currentResolved.NasEpDir : p.NasDir; int cnt = currentResolved != null ? currentResolved.NasCount : 0; CopyText("交付通知：\n项目：" + p.Name + "\n路径：" + path + " (" + cnt + "个)\n时间：" + DateTime.Now.ToString("yyyy-MM-dd")); }

        void ShowProjectDialog(int editIndex)
        {
            var dlg = new Form { Text = editIndex >= 0 ? "编辑项目" : "新建项目", Size = new Size(500, 260), StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
            int y = 10;
            dlg.Controls.Add(new Label { Text = "项目名称:", Location = new Point(15, y + 2), AutoSize = true });
            var txtN = new TextBox { Location = new Point(100, y), Width = 380 }; dlg.Controls.Add(txtN); y += 28;
            dlg.Controls.Add(new Label { Text = "本地根目录:", Location = new Point(15, y + 2), AutoSize = true });
            var txtL = new TextBox { Location = new Point(100, y), Width = 320 }; dlg.Controls.Add(txtL);
            var btnL = new Button { Text = "浏览", Location = new Point(425, y), Width = 55 }; btnL.Click += (s, e) => { using (var f = new FolderBrowserDialog()) { if (f.ShowDialog() == DialogResult.OK) txtL.Text = f.SelectedPath; } }; dlg.Controls.Add(btnL); y += 28;
            dlg.Controls.Add(new Label { Text = "NAS根目录:", Location = new Point(15, y + 2), AutoSize = true });
            var txtNa = new TextBox { Location = new Point(100, y), Width = 320 }; dlg.Controls.Add(txtNa);
            var btnNa = new Button { Text = "浏览", Location = new Point(425, y), Width = 55 }; btnNa.Click += (s, e) => { using (var f = new FolderBrowserDialog()) { if (f.ShowDialog() == DialogResult.OK) txtNa.Text = f.SelectedPath; } }; dlg.Controls.Add(btnNa); y += 28;
            dlg.Controls.Add(new Label { Text = "状态:", Location = new Point(15, y + 2), AutoSize = true });
            var cmb = new ComboBox { Location = new Point(100, y), Width = 120, DropDownStyle = ComboBoxStyle.DropDownList }; cmb.Items.AddRange(new[] { "进行中", "已完成" }); dlg.Controls.Add(cmb);
            if (editIndex >= 0) { var pp = projects[editIndex]; txtN.Text = pp.Name; txtL.Text = pp.LocalDir; txtNa.Text = pp.NasDir; cmb.SelectedIndex = pp.Status == "done" ? 1 : 0; } else cmb.SelectedIndex = 0; y += 35;
            var btnOk = new Button { Text = "保存", Location = new Point(300, y), Width = 80 }; btnOk.Click += (s, e) => { if (string.IsNullOrWhiteSpace(txtN.Text)) { MessageBox.Show("请输入名称"); return; } dlg.DialogResult = DialogResult.OK; dlg.Close(); }; dlg.Controls.Add(btnOk);
            var btnCc = new Button { Text = "取消", Location = new Point(390, y), Width = 80 }; btnCc.Click += (s, e) => dlg.Close(); dlg.Controls.Add(btnCc);
            if (dlg.ShowDialog() == DialogResult.OK) { var pr = editIndex >= 0 ? projects[editIndex] : new Project(); pr.Name = txtN.Text.Trim(); pr.LocalDir = txtL.Text.Trim(); pr.NasDir = txtNa.Text.Trim(); pr.Status = cmb.SelectedIndex == 1 ? "done" : "active"; if (editIndex < 0) projects.Add(pr); ProjectService.SaveProjects(projects); RefreshProjectTree(); SelectProject(editIndex >= 0 ? editIndex : projects.Count - 1); }
        }

        void ShowBatchImportDialog()
        {
            var dlg = new Form { Text = "批量导入", Size = new Size(760, 520), StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
            dlg.Controls.Add(new Label { Text = "本地根目录:", Location = new Point(15, 12), AutoSize = true }); var txtR = new TextBox { Location = new Point(100, 10), Width = 460 }; dlg.Controls.Add(txtR);
            var btnR = new Button { Text = "浏览", Location = new Point(565, 8), Width = 55 }; btnR.Click += (s, e) => { using (var f = new FolderBrowserDialog()) { if (f.ShowDialog() == DialogResult.OK) txtR.Text = f.SelectedPath; } }; dlg.Controls.Add(btnR);
            var grpT = new GroupBox { Text = "部门模板", Location = new Point(15, 40), Size = new Size(720, 110) };
            var tplP = new FlowLayoutPanel { Location = new Point(5, 16), AutoSize = true }; var tplL = new List<Tuple<TextBox, TextBox>>();
            Action rfT = null; rfT = () => { tplP.Controls.Clear(); tplL.Clear(); for (int i = 0; i < settings.Templates.Count; i++) { var t = settings.Templates[i]; var rw = new FlowLayoutPanel { AutoSize = true }; var tn = new TextBox { Width = 80, Text = t.Name }; var tp = new TextBox { Width = 500, Text = t.Path }; var bd = new Button { Text = "X", Width = 40 }; int ci = i; bd.Click += (s2, ev) => { settings.Templates.RemoveAt(ci); ProjectService.SaveSettings(settings); rfT(); }; rw.Controls.AddRange(new Control[] { tn, tp, bd }); tplP.Controls.Add(rw); tplL.Add(Tuple.Create(tn, tp)); } }; rfT();
            var btnAT = new Button { Text = "+ 添加", Location = new Point(5, 85), AutoSize = true }; btnAT.Click += (s, e) => { settings.Templates.Add(new DeptTemplate()); ProjectService.SaveSettings(settings); rfT(); };
            grpT.Controls.Add(tplP); grpT.Controls.Add(btnAT); dlg.Controls.Add(grpT);
            var btnSc = new Button { Text = "扫描子文件夹", Location = new Point(15, 158), AutoSize = true }; var lblSc = new Label { Location = new Point(130, 160), AutoSize = true };
            var clb = new CheckedListBox { Location = new Point(15, 188), Size = new Size(720, 200), CheckOnClick = true };
            btnSc.Click += (s, e) => { for (int i = 0; i < tplL.Count && i < settings.Templates.Count; i++) { settings.Templates[i].Name = tplL[i].Item1.Text; settings.Templates[i].Path = tplL[i].Item2.Text; } ProjectService.SaveSettings(settings); var en = new List<string>(); for (int i = 0; i < projects.Count; i++) en.Add(projects[i].Name); scanResults = ImportService.ScanLocalRoot(txtR.Text, en); clb.Items.Clear(); foreach (var r in scanResults) clb.Items.Add(r.Name + "    " + r.LocalDir, r.Checked); lblSc.Text = "可导入 " + scanResults.Count + " 个"; };
            dlg.Controls.Add(btnSc); dlg.Controls.Add(lblSc); dlg.Controls.Add(clb);
            var btnIm = new Button { Text = "导入选中", Location = new Point(420, 395), Width = 100, BackColor = Color.FromArgb(220, 235, 255) }; btnIm.Click += (s2, e2) => { if (scanResults == null) return; int ad = 0; for (int i = 0; i < scanResults.Count && i < clb.Items.Count; i++) if (clb.GetItemChecked(i)) { projects.Add(new Project { Name = scanResults[i].Name, LocalDir = scanResults[i].LocalDir, NasDir = "", Status = "active" }); ad++; } if (ad == 0) { MessageBox.Show("请先勾选"); return; } ProjectService.SaveProjects(projects); MessageBox.Show("导入 " + ad + " 个"); dlg.Close(); RefreshProjectTree(); }; dlg.Controls.Add(btnIm);
            var btnCl = new Button { Text = "关闭", Location = new Point(530, 395), Width = 80 }; btnCl.Click += (s, e) => dlg.Close(); dlg.Controls.Add(btnCl);
            dlg.ShowDialog();
        }
    }
}
