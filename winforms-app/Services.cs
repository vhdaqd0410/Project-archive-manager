using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

namespace ProjectArchiveManager
{
    static class JsonHelper
    {
        static JavaScriptSerializer js = new JavaScriptSerializer();
        public static T Deserialize<T>(string json) { return js.Deserialize<T>(json); }
        public static string Serialize(object obj) { return js.Serialize(obj); }
    }

    public static class ProjectService
    {
        static string AppDir
        {
            get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data"); }
        }
        static string AppProjectsFile { get { return Path.Combine(AppDir, "projects.json"); } }
        static string AppSettingsFile { get { return Path.Combine(AppDir, "settings.json"); } }

        public static List<Project> LoadProjects()
        {
            if (!File.Exists(AppProjectsFile)) return new List<Project>();
            try { return JsonHelper.Deserialize<List<Project>>(File.ReadAllText(AppProjectsFile, System.Text.Encoding.UTF8)) ?? new List<Project>(); }
            catch { return new List<Project>(); }
        }

        public static void SaveProjects(List<Project> projects)
        {
            Directory.CreateDirectory(AppDir);
            File.WriteAllText(AppProjectsFile, JsonHelper.Serialize(projects), System.Text.Encoding.UTF8);
        }

        public static Settings LoadSettings()
        {
            if (!File.Exists(AppSettingsFile)) return new Settings();
            try { return JsonHelper.Deserialize<Settings>(File.ReadAllText(AppSettingsFile, System.Text.Encoding.UTF8)) ?? new Settings(); }
            catch { return new Settings(); }
        }

        public static void SaveSettings(Settings s)
        {
            Directory.CreateDirectory(AppDir);
            File.WriteAllText(AppSettingsFile, JsonHelper.Serialize(s), System.Text.Encoding.UTF8);
        }
    }

    public static class FileService
    {
        public static string FindKeywordDir(string root, string keyword)
        {
            if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return null;
            try
            {
                var found = Directory.GetDirectories(root, "*" + keyword + "*", SearchOption.AllDirectories).FirstOrDefault();
                if (found == null) return null;
                string rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
                return found.Substring(rootFull.Length).TrimStart(Path.DirectorySeparatorChar);
            }
            catch { return null; }
        }

        public static EpisodeInfo ResolveEpisodeDirs(Project project, string keyword)
        {
            var info = new EpisodeInfo();
            string rel = FindKeywordDir(project.LocalDir, keyword) ?? FindKeywordDir(project.NasDir, keyword);
            info.RelPath = rel;
            if (rel == null) return info;
            info.LocalEpDir = Path.Combine(project.LocalDir, rel);
            info.NasEpDir = Path.Combine(project.NasDir, rel);
            info.LocalExists = Directory.Exists(info.LocalEpDir);
            info.NasExists = Directory.Exists(info.NasEpDir);
            if (info.LocalExists) try { info.LocalCount = Directory.GetFiles(info.LocalEpDir).Length; } catch { }
            if (info.NasExists) try { info.NasCount = Directory.GetFiles(info.NasEpDir).Length; } catch { }
            return info;
        }

        public static List<string> GetPendingFiles(string localDir, string nasDir)
        {
            var result = new List<string>();
            if (!Directory.Exists(localDir)) return result;
            var nasFiles = new HashSet<string>();
            if (Directory.Exists(nasDir))
                foreach (var f in Directory.GetFiles(nasDir)) nasFiles.Add(Path.GetFileName(f));
            foreach (var f in Directory.GetFiles(localDir))
            { var name = Path.GetFileName(f); if (!nasFiles.Contains(name)) result.Add(name); }
            result.Sort();
            return result;
        }

        public static void CopyDirectoryRecursive(string srcDir, string dstDir)
        {
            Directory.CreateDirectory(dstDir);
            foreach (var file in Directory.GetFiles(srcDir))
                File.Copy(file, Path.Combine(dstDir, Path.GetFileName(file)), true);
            foreach (var dir in Directory.GetDirectories(srcDir))
                CopyDirectoryRecursive(dir, Path.Combine(dstDir, Path.GetFileName(dir)));
        }

        public static int CountFilesRecursive(string dir)
        {
            if (!Directory.Exists(dir)) return 0;
            return Directory.GetFiles(dir).Length + Directory.GetDirectories(dir).Sum(d => CountFilesRecursive(d));
        }
    }

    public static class ImportService
    {
        public class ScanResult
        {
            public string Name;
            public string LocalDir;
            public bool Checked = true;
        }

        public static List<ScanResult> ScanLocalRoot(string localRoot, List<string> existingNames)
        {
            var results = new List<ScanResult>();
            if (!Directory.Exists(localRoot)) return results;
            var existing = new HashSet<string>(existingNames);
            foreach (var dir in Directory.GetDirectories(localRoot))
            {
                var name = Path.GetFileName(dir);
                if (existing.Contains(name)) continue;
                results.Add(new ScanResult { Name = name, LocalDir = dir });
            }
            return results;
        }
    }
}
