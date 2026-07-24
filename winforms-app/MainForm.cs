using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace ProjectArchiveManager
{
    public class MainForm : Form
    {
        List<Project> projects; Settings settings;
        int selectedIndex = -1; EpisodeInfo currentResolved;
        List<ImportService.ScanResult> scanResults;

        static readonly Color CSide = Color.FromArgb(28, 32, 38);
        static readonly Color CSideText = Color.FromArgb(200, 205, 215);
        static readonly Color CAccent = Color.FromArgb(59, 130, 246);
        static readonly Color CSuccess = Color.FromArgb(34, 197, 94);
        static readonly Color CWarn = Color.FromArgb(245, 158, 11);
        static readonly Color CDanger = Color.FromArgb(239, 68, 68);
        static readonly Color CGray = Color.FromArgb(100, 116, 139);
        static readonly Color CBorder = Color.FromArgb(226, 232, 240);
        static readonly Color CMain = Color.FromArgb(240, 242, 245);

        TableLayoutPanel leftPanel; TextBox txtSearch; TreeView tvProjects;
        Panel rightPanel; TextBox txtKeyword, txtLocalDir, txtNasDir;
        Label lblDetectLocal, lblDetectNas, lblDetectSummary, lblModifyInfo, lblModifySummary;
        CheckedListBox clbPending, clbModify;
        StatusStrip statusStrip; ToolStripStatusLabel lblStatus;

        public MainForm()
        {
            Text = "项目档案管理器"; Size = new Size(1100, 780); MinimumSize = new Size(950, 620);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 9.5f);
            BackColor = CMain; LoadData(); BuildUI(); RefreshProjectTree();
        }

        void LoadData() { projects = ProjectService.LoadProjects(); settings = ProjectService.LoadSettings(); foreach (var p in projects) if (string.IsNullOrEmpty(p.Status)) p.Status = "active"; }

        void BuildUI()
        {
            var ml = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2 };
            ml.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 250));
            ml.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            ml.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            ml.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            Controls.Add(ml);
            BuildLeftPanel(); ml.Controls.Add(leftPanel, 0, 0);
            BuildRightPanel(); ml.Controls.Add(rightPanel, 1, 0);
            statusStrip = new StatusStrip { BackColor = Color.FromArgb(248, 250, 252) };
            lblStatus = new ToolStripStatusLabel("就绪") { ForeColor = CGray };
            statusStrip.Items.Add(lblStatus); ml.Controls.Add(statusStrip, 0, 1); ml.SetColumnSpan(statusStrip, 2);
        }

        void BuildLeftPanel()
        {
            leftPanel = new TableLayoutPanel { BackColor = CSide, RowCount = 3, ColumnCount = 1 };
            leftPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            leftPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            leftPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));

            var sp = new Panel { Height = 42, Padding = new Padding(8, 8, 8, 4) };
            txtSearch = new TextBox { Dock = DockStyle.Fill, BorderStyle = BorderStyle.None, BackColor = Color.FromArgb(44, 50, 58), ForeColor = Color.FromArgb(220, 225, 235), Font = new Font("Microsoft YaHei UI", 9.5f) };
            txtSearch.TextChanged += (s, e) => RefreshProjectTree(); sp.Controls.Add(txtSearch); leftPanel.Controls.Add(sp);

            tvProjects = new TreeView { Dock = DockStyle.Fill, BackColor = CSide, ForeColor = CSideText, BorderStyle = BorderStyle.None, Font = new Font("Microsoft YaHei UI", 9.5f), HideSelection = false, FullRowSelect = true, Indent = 16, ItemHeight = 30 };
            tvProjects.DrawMode = TreeViewDrawMode.OwnerDrawAll; tvProjects.DrawNode += DrawNode;
            tvProjects.AfterSelect += (s, e) => { if (e.Node != null && e.Node.Tag is int) SelectProject((int)e.Node.Tag); };
            leftPanel.Controls.Add(tvProjects);

            var bp = new FlowLayoutPanel { BackColor = Color.FromArgb(22, 26, 32), Padding = new Padding(4, 6, 4, 6) };
            bp.Controls.AddRange(new[] { SBtn("+ 新建", CAccent, (s, e) => ShowProjectDialog(-1)), SBtn("编辑", CSideText, (s, e) => { if (selectedIndex >= 0) ShowProjectDialog(selectedIndex); }), SBtn("删除", CDanger, (s, e) => DeleteProject()), SBtn("批量导入", CWarn, (s, e) => ShowBatchImportDialog()) });
            leftPanel.Controls.Add(bp);
        }

        Button SBtn(string text, Color color, EventHandler handler) { var b = new Button { Text = text, FlatStyle = FlatStyle.Flat, ForeColor = color, BackColor = Color.Transparent, Font = new Font("Microsoft YaHei UI", 9f), AutoSize = true, Margin = new Padding(2), Padding = new Padding(8, 3, 8, 3) }; b.FlatAppearance.BorderSize = 0; b.FlatAppearance.MouseOverBackColor = Color.FromArgb(44, 50, 58); b.Click += handler; return b; }

        void DrawNode(object sender, DrawTreeNodeEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            if ((e.State & TreeNodeStates.Selected) != 0) { using (var b = new SolidBrush(Color.FromArgb(55, 65, 81))) g.FillRectangle(b, e.Bounds); g.DrawString(e.Node.Text, tvProjects.Font, Brushes.White, e.Bounds.X + 2, e.Bounds.Y + 3); }
            else if (e.Node.Tag is int && (int)e.Node.Tag < 0) g.DrawString(e.Node.Text, new Font(tvProjects.Font, FontStyle.Bold), new SolidBrush(Color.FromArgb(140, 150, 165)), e.Bounds.X, e.Bounds.Y + 3);
            else { var icon = e.Node.Tag is int && (int)e.Node.Tag >= 0 && (int)e.Node.Tag < projects.Count && projects[(int)e.Node.Tag].Status == "done" ? "✓ " : "  "; g.DrawString(icon + e.Node.Text, tvProjects.Font, new SolidBrush(e.Node.ForeColor.IsEmpty ? CSideText : e.Node.ForeColor), e.Bounds.X, e.Bounds.Y + 3); }
        }

        void BuildRightPanel()
        {
            rightPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(16, 12, 16, 12) };
            int y = 0, w = 800;

            var kp = new Panel { Location = new Point(0, y), Size = new Size(w, 36) };
            kp.Controls.Add(new Label { Text = "识别关键字", Location = new Point(0, 6), AutoSize = true, ForeColor = CGray });
            txtKeyword = new TextBox { Location = new Point(80, 4), Width = 160, Text = settings.Keyword, BorderStyle = BorderStyle.FixedSingle };
            kp.Controls.Add(txtKeyword);
            var kb = Btn("应用并扫描", CAccent, (s, e) => { settings.Keyword = txtKeyword.Text.Trim(); ProjectService.SaveSettings(settings); RefreshDetail(); }); kb.Location = new Point(248, 3); kb.Width = 100; kp.Controls.Add(kb);
            rightPanel.Controls.Add(kp); y += 44;

            var dc = Card("项目目录", w); dc.Location = new Point(0, y);
            dc.Controls.Add(new Label { Text = "本地", Location = new Point(12, 24), AutoSize = true, ForeColor = CGray });
            txtLocalDir = new TextBox { Location = new Point(60, 22), Width = w - 80, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = Color.White };
            dc.Controls.Add(txtLocalDir);
            dc.Controls.Add(new Label { Text = "NAS", Location = new Point(12, 48), AutoSize = true, ForeColor = CGray });
            txtNasDir = new TextBox { Location = new Point(60, 46), Width = w - 80, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = Color.White };
            dc.Controls.Add(txtNasDir); rightPanel.Controls.Add(dc); y += 82;

            var dtc = Card("关键词目录检测", w); dtc.Location = new Point(0, y);
            lblDetectLocal = new Label { Location = new Point(12, 22), AutoSize = true, ForeColor = CGray, Text = "未检测" };
            lblDetectNas = new Label { Location = new Point(12, 42), AutoSize = true, ForeColor = CGray, Text = "未检测" };
            lblDetectSummary = new Label { Location = new Point(12, 60), AutoSize = true, Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold) };
            dtc.Controls.Add(lblDetectLocal); dtc.Controls.Add(lblDetectNas); dtc.Controls.Add(lblDetectSummary);
            rightPanel.Controls.Add(dtc); y += 90;

            var ap = new FlowLayoutPanel { Location = new Point(0, y), AutoSize = true };
            ap.Controls.AddRange(new[] { Btn("打开本地", CAccent, (s, e) => { var p = CurrentProject(); if (p != null) OpenDir(currentResolved != null && currentResolved.LocalExists ? currentResolved.LocalEpDir : p.LocalDir); }), Btn("打开NAS", CAccent, (s, e) => { var p = CurrentProject(); if (p != null) OpenDir(currentResolved != null && currentResolved.NasExists ? currentResolved.NasEpDir : p.NasDir); }), Btn("复制NAS路径", CGray, (s, e) => { var p = CurrentProject(); if (p != null) CopyTxt(currentResolved != null ? currentResolved.NasEpDir : p.NasDir); }), Btn("复制交付信息", CGray, (s, e) => CopyMsg()) });
            rightPanel.Controls.Add(ap); y += 40;

            var pc = Card("待交付文件（本地有，NAS无）", w); pc.Location = new Point(0, y); pc.Size = new Size(w, 210);
            clbPending = new CheckedListBox { Location = new Point(12, 24), Size = new Size(w - 30, 110), BorderStyle = BorderStyle.FixedSingle, CheckOnClick = true, Font = new Font("Consolas", 9f) };
            var pb = new FlowLayoutPanel { Location = new Point(12, 140), AutoSize = true };
            pb.Controls.AddRange(new[] { Btn("刷新", CGray, (s, e) => RefreshPending()), Btn("全选", CGray, (s, e) => { for (int i = 0; i < clbPending.Items.Count; i++) clbPending.SetItemChecked(i, true); }), Btn("取消全选", CGray, (s, e) => { for (int i = 0; i < clbPending.Items.Count; i++) clbPending.SetItemChecked(i, false); }), Btn("复制选中到NAS", CWarn, (s, e) => CopyPending()) });
            pc.Controls.Add(clbPending); pc.Controls.Add(pb); rightPanel.Controls.Add(pc); y += 218;

            var mc = Card("上映单集版 - 修改交付", w); mc.Location = new Point(0, y); mc.Size = new Size(w, 190);
            lblModifyInfo = new Label { Location = new Point(12, 22), AutoSize = true, ForeColor = CGray, Text = "选择项目后自动检测" };
            lblModifySummary = new Label { Location = new Point(12, 40), AutoSize = true };
            clbModify = new CheckedListBox { Location = new Point(12, 58), Size = new Size(w - 30, 80), BorderStyle = BorderStyle.FixedSingle, CheckOnClick = true, Font = new Font("Consolas", 9f) };
            var mb = new FlowLayoutPanel { Location = new Point(12, 142), AutoSize = true };
            mb.Controls.AddRange(new[] { Btn("刷新", CGray, (s, e) => RefreshModify()), Btn("全选", CGray, (s, e) => { for (int i = 0; i < clbModify.Items.Count; i++) clbModify.SetItemChecked(i, true); }), Btn("复制选中到NAS", CWarn, (s, e) => CopyModifyBatches()) });
            mc.Controls.Add(lblModifyInfo); mc.Controls.Add(lblModifySummary); mc.Controls.Add(clbModify); mc.Controls.Add(mb);
            rightPanel.Controls.Add(mc);
        }

        Panel Card(string title, int width) { var p = new Panel { Size = new Size(width, 80), BackColor = Color.White }; p.Paint += (s, e) => { var r = p.ClientRectangle; r.Width--; r.Height--; e.Graphics.DrawRectangle(new Pen(CBorder), r); e.Graphics.DrawString(title, new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold), new SolidBrush(Color.FromArgb(30, 41, 59)), 12, 6); e.Graphics.DrawLine(new Pen(Color.FromArgb(241, 245, 249)), 12, 22, p.Width - 12, 22); }; return p; }

        Button Btn(string text, Color bg, EventHandler handler) { var b = new Button { Text = text, FlatStyle = FlatStyle.Flat, BackColor = bg, ForeColor = Color.White, Font = new Font("Microsoft YaHei UI", 9f), AutoSize = true, Margin = new Padding(2), Padding = new Padding(12, 5, 12, 5), Cursor = Cursors.Hand }; b.FlatAppearance.BorderSize = 0; b.FlatAppearance.MouseOverBackColor = ControlPaint.Dark(bg); b.Click += handler; return b; }

        Project CurrentProject() { return selectedIndex >= 0 && selectedIndex < projects.Count ? projects[selectedIndex] : null; }

        void RefreshProjectTree()
        {
            tvProjects.BeginUpdate(); tvProjects.Nodes.Clear();
            var search = txtSearch.Text.Trim().ToLower();
            var active = new List<Tuple<Project, int>>(); var done = new List<Tuple<Project, int>>();
            for (int i = 0; i < projects.Count; i++) { var p = projects[i]; if (!string.IsNullOrEmpty(search) && !p.Name.ToLower().Contains(search)) continue; if (p.Status == "done") done.Add(Tuple.Create(p, i)); else active.Add(Tuple.Create(p, i)); }
            var an = new TreeNode("▸ 进行中 (" + active.Count + ")") { Tag = -1 };
            foreach (var a in active) an.Nodes.Add(new TreeNode(a.Item1.Name) { Tag = a.Item2, ForeColor = a.Item2 == selectedIndex ? Color.White : CSideText, BackColor = a.Item2 == selectedIndex ? Color.FromArgb(55, 65, 81) : CSide });
            tvProjects.Nodes.Add(an);
            var dn = new TreeNode("▸ 已完成 (" + done.Count + ")") { Tag = -1 };
            foreach (var d in done) dn.Nodes.Add(new TreeNode(d.Item1.Name) { Tag = d.Item2, ForeColor = d.Item2 == selectedIndex ? Color.White : Color.FromArgb(120, 130, 145), BackColor = d.Item2 == selectedIndex ? Color.FromArgb(55, 65, 81) : CSide });
            tvProjects.Nodes.Add(dn); an.Expand(); dn.Expand(); tvProjects.EndUpdate();
        }

        void SelectProject(int idx) { selectedIndex = idx; currentResolved = null; RefreshProjectTree(); RefreshDetail(); RefreshModify(); }
        void DeleteProject() { if (selectedIndex < 0) return; if (MessageBox.Show("确定删除「" + projects[selectedIndex].Name + "」？", "确认", MessageBoxButtons.YesNo) != DialogResult.Yes) return; projects.RemoveAt(selectedIndex); ProjectService.SaveProjects(projects); if (selectedIndex >= projects.Count) selectedIndex = projects.Count - 1; RefreshProjectTree(); if (selectedIndex >= 0) SelectProject(selectedIndex); }

        void RefreshDetail()
        {
            var p = CurrentProject(); if (p == null) return;
            txtLocalDir.Text = p.LocalDir; txtNasDir.Text = p.NasDir;
            lblDetectLocal.Text = "扫描中..."; lblDetectLocal.ForeColor = CGray;
            lblDetectNas.Text = "扫描中..."; lblDetectNas.ForeColor = CGray;
            lblDetectSummary.Text = ""; Application.DoEvents();
            currentResolved = FileService.ResolveEpisodeDirs(p, settings.Keyword);
            if (currentResolved.RelPath == null) { var m = "未找到含\"" + settings.Keyword + "\"的子目录"; lblDetectLocal.Text = m; lblDetectNas.Text = m; }
            else { lblDetectLocal.Text = currentResolved.LocalEpDir + "  [" + (currentResolved.LocalExists ? currentResolved.LocalCount + " 个文件" : "不存在") + "]"; lblDetectLocal.ForeColor = currentResolved.LocalExists ? CSuccess : CDanger; lblDetectNas.Text = currentResolved.NasEpDir + "  [" + (currentResolved.NasExists ? currentResolved.NasCount + " 个文件" : "不存在") + "]"; lblDetectNas.ForeColor = currentResolved.NasExists ? CSuccess : CGray; int d = currentResolved.LocalCount - currentResolved.NasCount; if (d > 0) { lblDetectSummary.Text = "本地比NAS多 " + d + " 个文件，需要交付"; lblDetectSummary.ForeColor = CWarn; } else if (currentResolved.LocalExists && currentResolved.NasExists) { lblDetectSummary.Text = "本地与NAS文件一致"; lblDetectSummary.ForeColor = CSuccess; } }
            RefreshPending();
        }

        void RefreshPending() { clbPending.Items.Clear(); if (currentResolved == null || !currentResolved.LocalExists) return; var fs = FileService.GetPendingFiles(currentResolved.LocalEpDir, currentResolved.NasEpDir); foreach (var f in fs) clbPending.Items.Add(f, true); lblStatus.Text = "待交付 " + fs.Count + " 个文件"; }
        void CopyPending() { if (currentResolved == null) return; var its = new List<string>(); foreach (var it in clbPending.CheckedItems) its.Add(it.ToString()); if (its.Count == 0) { MessageBox.Show("请先勾选"); return; } int ok = 0; foreach (var f in its) { try { File.Copy(Path.Combine(currentResolved.LocalEpDir, f), Path.Combine(currentResolved.NasEpDir, f), true); ok++; } catch { } } SetStatus("复制完成：" + ok + " 成功"); RefreshDetail(); }

        void RefreshModify()
        {
            clbModify.Items.Clear(); lblModifyInfo.Text = "检测中..."; lblModifyInfo.ForeColor = CGray; var p = CurrentProject(); if (p == null) { lblModifyInfo.Text = "请选择项目"; return; }
            string kw = "上映单集版"; string rel = FileService.FindKeywordDir(p.LocalDir, kw) ?? FileService.FindKeywordDir(p.NasDir, kw);
            if (rel == null) { lblModifyInfo.Text = "未找到\"" + kw + "\"目录"; return; }
            string lk = Path.Combine(p.LocalDir, rel), nk = Path.Combine(p.NasDir, rel); lblModifyInfo.Text = "本地: " + lk + "\nNAS: " + nk;
            if (!Directory.Exists(lk)) { lblModifySummary.Text = "本地目录不存在"; return; }
            var ds = Directory.GetDirectories(lk).Select(Path.GetFileName).ToList(); ds.Sort((a, b) => b.CompareTo(a)); int nc = 0;
            foreach (var d in ds) { bool ne = Directory.Exists(Path.Combine(nk, d)); int lc = FileService.CountFilesRecursive(Path.Combine(lk, d)); clbModify.Items.Add(d + "  (" + lc + " 个)  " + (ne ? "[已交付]" : "[待交付]"), !ne); if (!ne) nc++; }
            lblModifySummary.Text = nc > 0 ? nc + " 个批次待交付" : "所有批次已交付"; lblModifySummary.ForeColor = nc > 0 ? CWarn : CSuccess;
        }

        void CopyModifyBatches()
        {
            var p = CurrentProject(); if (p == null) return; string kw = "上映单集版"; string rel = FileService.FindKeywordDir(p.LocalDir, kw) ?? FileService.FindKeywordDir(p.NasDir, kw); if (rel == null) return;
            string lk = Path.Combine(p.LocalDir, rel), nk = Path.Combine(p.NasDir, rel); var ns = new List<string>();
            for (int i = 0; i < clbModify.Items.Count; i++) if (clbModify.GetItemChecked(i)) { var t = clbModify.Items[i].ToString(); ns.Add(t.Split(' ')[0]); }
            if (ns.Count == 0) { MessageBox.Show("请先勾选"); return; }
            int ok = 0, fl = 0; foreach (var n in ns) { try { FileService.CopyDirectoryRecursive(Path.Combine(lk, n), Path.Combine(nk, n)); ok++; } catch { fl++; } }
            SetStatus("复制完成：" + ok + " 成功，" + fl + " 失败"); RefreshModify();
        }

        void OpenDir(string path) { if (!string.IsNullOrEmpty(path) && Directory.Exists(path)) Process.Start("explorer.exe", path); }
        void CopyTxt(string t) { if (!string.IsNullOrEmpty(t)) { Clipboard.SetText(t); SetStatus("已复制到剪贴板"); } }
        void CopyMsg() { var p = CurrentProject(); if (p == null) return; string path = currentResolved != null ? currentResolved.NasEpDir : p.NasDir; int cnt = currentResolved != null ? currentResolved.NasCount : 0; CopyTxt("交付通知：\n项目：" + p.Name + "\n路径：" + path + " (" + cnt + " 个)\n时间：" + DateTime.Now.ToString("yyyy-MM-dd")); }
        void SetStatus(string msg) { lblStatus.Text = msg; }

        void ShowProjectDialog(int editIndex)
        {
            var dlg = new Form { Text = editIndex >= 0 ? "编辑项目" : "新建项目", Size = new Size(520, 280), StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, BackColor = Color.White };
            int y = 16;
            dlg.Controls.Add(new Label { Text = "项目名称", Location = new Point(20, y + 2), AutoSize = true, ForeColor = CGray }); var txtN = new TextBox { Location = new Point(115, y), Width = 370, BorderStyle = BorderStyle.FixedSingle }; dlg.Controls.Add(txtN); y += 34;
            dlg.Controls.Add(new Label { Text = "本地根目录", Location = new Point(20, y + 2), AutoSize = true, ForeColor = CGray }); var txtL = new TextBox { Location = new Point(115, y), Width = 300, BorderStyle = BorderStyle.FixedSingle }; dlg.Controls.Add(txtL);
            var bl = Btn("浏览", CGray, null); bl.Location = new Point(420, y); bl.Width = 60; bl.Click += (s, e) => { using (var f = new FolderBrowserDialog()) { if (f.ShowDialog() == DialogResult.OK) txtL.Text = f.SelectedPath; } }; dlg.Controls.Add(bl); y += 34;
            dlg.Controls.Add(new Label { Text = "NAS根目录", Location = new Point(20, y + 2), AutoSize = true, ForeColor = CGray }); var txtNa = new TextBox { Location = new Point(115, y), Width = 300, BorderStyle = BorderStyle.FixedSingle }; dlg.Controls.Add(txtNa);
            var bn = Btn("浏览", CGray, null); bn.Location = new Point(420, y); bn.Width = 60; bn.Click += (s, e) => { using (var f = new FolderBrowserDialog()) { if (f.ShowDialog() == DialogResult.OK) txtNa.Text = f.SelectedPath; } }; dlg.Controls.Add(bn); y += 34;
            dlg.Controls.Add(new Label { Text = "状态", Location = new Point(20, y + 2), AutoSize = true, ForeColor = CGray }); var cmb = new ComboBox { Location = new Point(115, y), Width = 130, DropDownStyle = ComboBoxStyle.DropDownList }; cmb.Items.AddRange(new[] { "进行中", "已完成" }); dlg.Controls.Add(cmb);
            if (editIndex >= 0) { var pp = projects[editIndex]; txtN.Text = pp.Name; txtL.Text = pp.LocalDir; txtNa.Text = pp.NasDir; cmb.SelectedIndex = pp.Status == "done" ? 1 : 0; } else cmb.SelectedIndex = 0; y += 42;
            var bo = Btn("保存", CAccent, null); bo.Location = new Point(300, y); bo.Width = 90; bo.Click += (s, e) => { if (string.IsNullOrWhiteSpace(txtN.Text)) { MessageBox.Show("请输入名称"); return; } dlg.DialogResult = DialogResult.OK; dlg.Close(); }; dlg.Controls.Add(bo);
            var bc = Btn("取消", CGray, null); bc.Location = new Point(400, y); bc.Width = 85; bc.Click += (s, e) => dlg.Close(); dlg.Controls.Add(bc);
            if (dlg.ShowDialog() == DialogResult.OK) { var pr = editIndex >= 0 ? projects[editIndex] : new Project(); pr.Name = txtN.Text.Trim(); pr.LocalDir = txtL.Text.Trim(); pr.NasDir = txtNa.Text.Trim(); pr.Status = cmb.SelectedIndex == 1 ? "done" : "active"; if (editIndex < 0) projects.Add(pr); ProjectService.SaveProjects(projects); RefreshProjectTree(); SelectProject(editIndex >= 0 ? editIndex : projects.Count - 1); }
        }

        void ShowBatchImportDialog()
        {
            var dlg = new Form { Text = "批量导入项目", Size = new Size(780, 540), StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, BackColor = Color.White };
            
            dlg.Controls.Add(new Label { Text = "本地根目录", Location = new Point(20, 18), AutoSize = true, ForeColor = CGray }); var txtR = new TextBox { Location = new Point(115, 16), Width = 470, BorderStyle = BorderStyle.FixedSingle }; dlg.Controls.Add(txtR);
            var br = Btn("浏览", CGray, null); br.Location = new Point(590, 14); br.Width = 60; br.Click += (s, e) => { using (var f = new FolderBrowserDialog()) { if (f.ShowDialog() == DialogResult.OK) txtR.Text = f.SelectedPath; } }; dlg.Controls.Add(br);
            var grpT = new GroupBox { Text = "部门 NAS 模板", Location = new Point(20, 52), Size = new Size(730, 120) };
            var tplP = new FlowLayoutPanel { Location = new Point(8, 20), AutoSize = true }; var tplL = new List<Tuple<TextBox, TextBox>>();
            Action rfT = null; rfT = () => { tplP.Controls.Clear(); tplL.Clear(); for (int i = 0; i < settings.Templates.Count; i++) { var t = settings.Templates[i]; var rw = new FlowLayoutPanel { AutoSize = true }; var tn = new TextBox { Width = 90, Text = t.Name, BorderStyle = BorderStyle.FixedSingle }; var tp = new TextBox { Width = 520, Text = t.Path, BorderStyle = BorderStyle.FixedSingle }; var bd = Btn("X", CDanger, null); bd.Width = 35; int ci = i; bd.Click += (s2, ev) => { settings.Templates.RemoveAt(ci); ProjectService.SaveSettings(settings); rfT(); }; rw.Controls.AddRange(new Control[] { tn, tp, bd }); tplP.Controls.Add(rw); tplL.Add(Tuple.Create(tn, tp)); } }; rfT();
            var bat = Btn("+ 添加模板", CGray, null); bat.Location = new Point(8, 88); bat.Width = 100; bat.Click += (s, e) => { settings.Templates.Add(new DeptTemplate()); ProjectService.SaveSettings(settings); rfT(); };
            grpT.Controls.Add(tplP); grpT.Controls.Add(bat); dlg.Controls.Add(grpT);
            var bsc = Btn("扫描子文件夹", CAccent, null); bsc.Location = new Point(20, 180); bsc.AutoSize = true; dlg.Controls.Add(bsc);
            var lblSc = new Label { Location = new Point(135, 184), AutoSize = true, ForeColor = CGray }; dlg.Controls.Add(lblSc);
            var clb = new CheckedListBox { Location = new Point(20, 212), Size = new Size(730, 220), BorderStyle = BorderStyle.FixedSingle, CheckOnClick = true, Font = new Font("Consolas", 9f) }; dlg.Controls.Add(clb);
            bsc.Click += (s, e) => { for (int i = 0; i < tplL.Count && i < settings.Templates.Count; i++) { settings.Templates[i].Name = tplL[i].Item1.Text; settings.Templates[i].Path = tplL[i].Item2.Text; } ProjectService.SaveSettings(settings); var en = new List<string>(); for (int i = 0; i < projects.Count; i++) en.Add(projects[i].Name); scanResults = ImportService.ScanLocalRoot(txtR.Text, en); clb.Items.Clear(); foreach (var r in scanResults) clb.Items.Add(r.Name + "    " + r.LocalDir, r.Checked); lblSc.Text = "可导入 " + scanResults.Count + " 个"; };
            var bim = Btn("导入选中项目", CWarn, null); bim.Location = new Point(430, 440); bim.Width = 130; bim.Click += (s2, e2) => { if (scanResults == null) return; int ad = 0; for (int i = 0; i < scanResults.Count && i < clb.Items.Count; i++) if (clb.GetItemChecked(i)) { projects.Add(new Project { Name = scanResults[i].Name, LocalDir = scanResults[i].LocalDir, NasDir = "", Status = "active" }); ad++; } if (ad == 0) { MessageBox.Show("请先勾选"); return; } ProjectService.SaveProjects(projects); SetStatus("导入 " + ad + " 个"); dlg.Close(); RefreshProjectTree(); }; dlg.Controls.Add(bim);
            var bcl = Btn("关闭", CGray, null); bcl.Location = new Point(570, 440); bcl.Width = 85; bcl.Click += (s, e) => dlg.Close(); dlg.Controls.Add(bcl);
            dlg.ShowDialog();
        }
    }
}
