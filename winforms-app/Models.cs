using System;
using System.Collections.Generic;

namespace ProjectArchiveManager
{
    public class Project
    {
        public string Name { get; set; }
        public string LocalDir { get; set; }
        public string NasDir { get; set; }
        public string Status { get; set; }

        public Project()
        {
            Name = "";
            LocalDir = "";
            NasDir = "";
            Status = "active";
        }
    }

    public class Settings
    {
        public string Keyword { get; set; }
        public List<DeptTemplate> Templates { get; set; }

        public Settings()
        {
            Keyword = "项目归档资料";
            Templates = new List<DeptTemplate>();
        }
    }

    public class DeptTemplate
    {
        public string Name { get; set; }
        public string Path { get; set; }

        public DeptTemplate()
        {
            Name = "";
            Path = "";
        }
    }

    public class EpisodeInfo
    {
        public string RelPath { get; set; }
        public string LocalEpDir { get; set; }
        public string NasEpDir { get; set; }
        public bool LocalExists { get; set; }
        public bool NasExists { get; set; }
        public int LocalCount { get; set; }
        public int NasCount { get; set; }
    }

    public class ModifyBatch
    {
        public string Name { get; set; }
        public string LocalPath { get; set; }
        public string NasPath { get; set; }
        public int LocalFileCount { get; set; }
        public bool NasExists { get; set; }
        public int NasFileCount { get; set; }
    }

    public class TemplateInfo
    {
        public string Name { get; set; }
        public string Path { get; set; }
        public TemplateInfo() { Name = ""; Path = ""; }
    }
}
