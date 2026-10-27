// Installateur de PouleyPwolu pour Windows : une fenêtre aux couleurs de PouleyPwolu
// autour de mini_installer (l'installateur de Chromium, sans interface), collé à la fin
// de cet exécutable par build-installateur.ps1.
//
// Compilé par le csc de .NET Framework 4 (présent sur tout Windows 10 et 11) : C# 5,
// donc ni $"", ni ?., ni nameof.
//
// /S (passage depuis la version Electron) : installe sans fenêtre puis ouvre PouleyPwolu.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Installateur de PouleyPwolu")]
[assembly: AssemblyProduct("PouleyPwolu")]
[assembly: AssemblyCompany("Nads")]
[assembly: AssemblyCopyright("© 2026 Nadir Tounsi (Nads)")]

namespace Pouley
{
    static class Programme
    {
        [STAThread]
        static int Main(string[] args)
        {
            bool silencieux = false;
            foreach (string a in args)
            {
                if (a == "/S" || a == "/s" || a == "--silent") silencieux = true;
                if (a == "--essai") Installation.Essai = true;
            }
            if (silencieux) return Installation.Silencieuse();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Fenetre());
            return 0;
        }
    }

    // Extraction et lancement de mini_installer, et ce qui entoure l'installation.
    static class Installation
    {
        const string Magie = "POULEYPW";

        // --essai : l'interface fait semblant d'installer (rien n'est fermé ni installé).
        public static bool Essai;

        public static string Dossier
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "PouleyPwolu", "Application");
            }
        }

        public static string Exe { get { return Path.Combine(Dossier, "chrome.exe"); } }

        public static bool DejaInstalle { get { return File.Exists(Exe); } }

        // Processus de PouleyPwolu en cours (celui installé, pas un autre Chromium).
        public static List<Process> Ouverts()
        {
            List<Process> l = new List<Process>();
            foreach (Process p in Process.GetProcessesByName("chrome"))
            {
                try
                {
                    string chemin = p.MainModule.FileName;
                    if (chemin.StartsWith(Dossier, StringComparison.OrdinalIgnoreCase)) l.Add(p);
                }
                catch { }
            }
            return l;
        }

        // Ferme PouleyPwolu poliment (ses onglets reviennent au prochain démarrage),
        // puis de force ce qui reste après 10 secondes.
        public static void Fermer()
        {
            if (Essai) return;
            List<Process> l = Ouverts();
            foreach (Process p in l)
            {
                try { if (p.MainWindowHandle != IntPtr.Zero) p.CloseMainWindow(); } catch { }
            }
            Stopwatch montre = Stopwatch.StartNew();
            while (montre.ElapsedMilliseconds < 10000 && Ouverts().Count > 0) Thread.Sleep(250);
            foreach (Process p in Ouverts())
            {
                try { p.Kill(); } catch { }
            }
            Thread.Sleep(500);
        }

        // Copie l'installateur de Chromium (collé à la fin de cet exécutable) dans un
        // dossier temporaire.
        static string Extraire()
        {
            string moi = Assembly.GetExecutingAssembly().Location;
            string dir = Path.Combine(Path.GetTempPath(), "PouleyPwolu-installation-" + Process.GetCurrentProcess().Id);
            Directory.CreateDirectory(dir);
            string sortie = Path.Combine(dir, "mini_installer.exe");
            using (FileStream f = new FileStream(moi, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                byte[] fin = new byte[16];
                f.Seek(-16, SeekOrigin.End);
                f.Read(fin, 0, 16);
                if (Encoding.ASCII.GetString(fin, 8, 8) != Magie)
                    throw new InvalidDataException("Installateur incomplet : téléchargez-le à nouveau.");
                long taille = BitConverter.ToInt64(fin, 0);
                f.Seek(-16 - taille, SeekOrigin.End);
                using (FileStream o = new FileStream(sortie, FileMode.Create, FileAccess.Write))
                {
                    byte[] tampon = new byte[1 << 20];
                    long reste = taille;
                    while (reste > 0)
                    {
                        int n = f.Read(tampon, 0, (int)Math.Min(tampon.Length, reste));
                        if (n <= 0) throw new EndOfStreamException("Installateur incomplet : téléchargez-le à nouveau.");
                        o.Write(tampon, 0, n);
                        reste -= n;
                    }
                }
            }
            return sortie;
        }

        // Installe (ou met à jour) et renvoie le code de sortie de mini_installer (0 = réussi).
        public static int Installer()
        {
            if (Essai) { Thread.Sleep(8000); return 0; }
            string mini = Extraire();
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(mini, "--do-not-launch-chrome --verbose-logging");
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                using (Process p = Process.Start(info))
                {
                    p.WaitForExit();
                    return p.ExitCode;
                }
            }
            finally
            {
                try { Directory.Delete(Path.GetDirectoryName(mini), true); } catch { }
            }
        }

        public static void Ouvrir()
        {
            try { Process.Start(new ProcessStartInfo(Exe) { UseShellExecute = true, WorkingDirectory = Dossier }); } catch { }
        }

        // PouleyPwolu est-il déjà le navigateur par défaut ?
        public static bool ParDefaut()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice"))
                {
                    string id = k == null ? null : k.GetValue("ProgId") as string;
                    return id != null && id.StartsWith("Pouley", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch { return false; }
        }

        // Windows ne laisse aucune application se choisir : on ouvre la page de PouleyPwolu
        // dans « Applications par défaut ».
        public static void ChoisirParDefaut()
        {
            string nom = null;
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications"))
                {
                    if (k != null)
                        foreach (string v in k.GetValueNames())
                        {
                            string d = k.GetValue(v) as string;
                            if (d != null && d.IndexOf(@"StartMenuInternet\PouleyPwolu", StringComparison.OrdinalIgnoreCase) >= 0) { nom = v; break; }
                        }
                }
            }
            catch { }
            string url = nom == null ? "ms-settings:defaultapps" : "ms-settings:defaultapps?registeredAppUser=" + Uri.EscapeDataString(nom);
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        public static int Silencieuse()
        {
            try
            {
                int code = Installer();
                if (code == 0) Ouvrir();
                return code;
            }
            catch { return 1; }
        }
    }

    // Les sprites de engine/extension/lib/sprites.js.
    static class Sprites
    {
        public static readonly string[] Poule = {
            "....B.BB.B..............",
            "...BYBYYBYB.............",
            "....BYYyYYYB............",
            "....BYYYYYYYB......Y..Y.",
            "...BBYYKYYYYB.....BYBBYB",
            "..BYYBYYYYYYB....BYYBYYB",
            "..BBBBYYYYYYB...BYYBYYB.",
            "....BYYYYYYYB..BYYBYYYB.",
            "....BYYYYYYYYBBYYBYYYB..",
            "...BYYYYYYYYYYYYYYYYYB..",
            "..BYYYYYYYYYYYYYYYYYYB..",
            "..BYYYYYYBBYYYYYBBYYYB..",
            "..BYYYYYYYBBBBBBYYYYB...",
            "..BYYYYYYYYYYYYYYYYYB...",
            "..BYYYYYYYYYYYYYYYYB....",
            "...BYYYYYYYYYYYYYYB.....",
            "....BBYYYYYYYYYYBB......",
            "......BBBYYYYBBB........",
            "........BY..BY..........",
            "........BY..BY..........",
            ".......YYY.YYY..........",
            "......YY.Y.Y.YY.........",
        };

        public static readonly string[][] Course = {
            new string[] {
                "................", "....BBB.........", "...BYYYB........", "..BYKYYB....YY..",
                ".BBYYYYB...BYYB.", "B.BYYYYBB.BYYB..", "..BYYYYYYBYYYB..", "..BYYYYYYYYYYB..",
                "..BYYYBBBYYYB...", "..BYYYYYYYYYB...", "...BYYYYYYYB....", "....BBYYYBB.....",
                ".....BY.BY......", ".....BY..YY.....", "....YY....Y.....", "................",
            },
            new string[] {
                "................", "....BBB.........", "...BYYYB........", "..BYKYYB....YY..",
                ".BBYYYYB...BYYB.", "B.BYYYYBB.BYYB..", "..BYYYYYYBYYYB..", "..BYYYYYYYYYYB..",
                "..BYYBBBYYYYB...", "..BYYYYYYYYYB...", "...BYYYYYYYB....", "....BBYYYBB.....",
                "......BYBY......", ".....YY.BY......", ".........YY.....", "................",
            },
        };

        static Color Couleur(char c)
        {
            switch (c)
            {
                case 'Y': return Color.FromArgb(0xFF, 0xE1, 0x00);
                case 'y': return Color.FromArgb(0xFF, 0xF2, 0x7A);
                case 'B': return Color.FromArgb(0x15, 0x65, 0xD8);
                case 'K': return Color.FromArgb(0x0E, 0x0E, 0x10);
                default: return Color.Transparent;
            }
        }

        // Dessine le sprite, pixel par pixel ; « miroir » le tourne vers la droite.
        public static void Dessiner(Graphics g, string[] s, float x, float y, float px, bool miroir)
        {
            SmoothingMode avant = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.None;
            for (int r = 0; r < s.Length; r++)
                for (int c = 0; c < s[r].Length; c++)
                {
                    char ch = s[r][c];
                    if (ch == '.') continue;
                    int col = miroir ? s[r].Length - 1 - c : c;
                    using (SolidBrush b = new SolidBrush(Couleur(ch)))
                        g.FillRectangle(b, (float)Math.Round(x + col * px), (float)Math.Round(y + r * px),
                            (float)Math.Ceiling(px), (float)Math.Ceiling(px));
                }
            g.SmoothingMode = avant;
        }
    }

    enum Ecran { Accueil, Installation, Fini, Erreur }

    sealed class Fenetre : Form
    {
        // Couleurs de PouleyPwolu (engine/extension/pages/pages.css).
        static readonly Color Fond = Color.FromArgb(0x11, 0x11, 0x13);
        static readonly Color Panneau = Color.FromArgb(0x26, 0x26, 0x2A);
        static readonly Color Texte = Color.FromArgb(0xC9, 0xC9, 0xD0);
        static readonly Color Discret = Color.FromArgb(0x8B, 0x8B, 0x95);
        static readonly Color Clair = Color.FromArgb(0xF4, 0xF4, 0xF5);
        static readonly Color Jaune = Color.FromArgb(0xFF, 0xE1, 0x00);
        static readonly Color JauneClair = Color.FromArgb(0xFF, 0xF2, 0x7A);
        static readonly Color Rouge = Color.FromArgb(0xEF, 0x3E, 0x36);

        const int L = 540, H = 420; // taille en pixels à 100 %

        readonly float k; // échelle de l'écran
        readonly List<PrivateFontCollection> polices = new List<PrivateFontCollection>();
        readonly FontFamily onest, onestGras, mono;
        readonly System.Windows.Forms.Timer minuterie = new System.Windows.Forms.Timer();
        readonly Stopwatch horloge = Stopwatch.StartNew();
        readonly string version;

        Ecran ecran = Ecran.Accueil;
        bool parDefaut = true;
        readonly bool dejaDefaut, miseAJour;
        string erreur = "";
        double debut, finInstall = -1, progression;
        string survol = null;
        bool fermerPouley;

        // Zones cliquables du dernier dessin.
        readonly Dictionary<string, RectangleF> zones = new Dictionary<string, RectangleF>();

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int t);
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        public Fenetre()
        {
            SetProcessDPIAware();
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) k = g.DpiX / 96f;

            onest = Police("Onest-Regular.ttf", "Segoe UI");
            onestGras = Police("Onest-SemiBold.ttf", "Segoe UI Semibold");
            mono = Police("JetBrainsMono-Regular.ttf", "Consolas");
            version = Ressource("version.txt");

            miseAJour = Installation.DejaInstalle;
            dejaDefaut = Installation.ParDefaut();
            fermerPouley = Installation.Ouverts().Count > 0;

            Text = "Installer PouleyPwolu";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size((int)(L * k), (int)(H * k));
            BackColor = Fond;
            DoubleBuffered = true;
            ShowInTaskbar = true;
            try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

            minuterie.Interval = 16;
            minuterie.Tick += delegate { Avancer(); Invalidate(); };
            minuterie.Start();
        }

        double affichee = double.MaxValue; // moment où la fenêtre est apparue

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            affichee = T;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // Windows 11 : coins arrondis et mode sombre de la fenêtre.
            int rond = 2, sombre = 1;
            try
            {
                DwmSetWindowAttribute(Handle, 33, ref rond, 4);
                DwmSetWindowAttribute(Handle, 20, ref sombre, 4);
            }
            catch { }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams p = base.CreateParams;
                p.ClassStyle |= 0x20000; // CS_DROPSHADOW
                p.Style |= 0x20000; // WS_MINIMIZEBOX : réduire depuis la barre des tâches
                return p;
            }
        }

        static string Ressource(string nom)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(nom))
            {
                if (s == null) return "";
                using (StreamReader r = new StreamReader(s)) return r.ReadToEnd().Trim();
            }
        }

        FontFamily Police(string fichier, string secours)
        {
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(fichier))
                {
                    if (s != null)
                    {
                        byte[] d = new byte[s.Length];
                        s.Read(d, 0, d.Length);
                        IntPtr p = Marshal.AllocCoTaskMem(d.Length); // gardée jusqu'à la fin
                        Marshal.Copy(d, 0, p, d.Length);
                        // Une collection par police : sa seule famille est la bonne.
                        PrivateFontCollection c = new PrivateFontCollection();
                        c.AddMemoryFont(p, d.Length);
                        polices.Add(c);
                        if (c.Families.Length > 0) return c.Families[0];
                    }
                }
            }
            catch { }
            return new FontFamily(secours);
        }

        double T { get { return horloge.Elapsed.TotalSeconds; } }

        void Avancer()
        {
            if (ecran != Ecran.Installation) return;
            double t = T - debut;
            // Durée inconnue : la barre approche 92 % puis finit quand l'installation a fini.
            double estime = 0.92 * (1 - Math.Exp(-t / 16.0));
            if (finInstall >= 0)
            {
                double f = Math.Min(1, (T - finInstall) / 0.6);
                progression = progression + (1 - progression) * f;
                if (f >= 1)
                {
                    ecran = Ecran.Fini;
                    debut = T;
                }
            }
            else progression = Math.Max(progression, estime);
        }

        void Lancer()
        {
            ecran = Ecran.Installation;
            debut = T;
            progression = 0;
            finInstall = -1;
            Thread th = new Thread(delegate ()
            {
                int code;
                string message = "";
                try
                {
                    if (fermerPouley) Installation.Fermer();
                    code = Installation.Installer();
                }
                catch (Exception ex) { code = -1; message = ex.Message; }
                BeginInvoke((MethodInvoker)delegate
                {
                    if (code == 0) finInstall = T;
                    else
                    {
                        erreur = message.Length > 0 ? message : "Code " + code + ". Le journal est dans %TEMP%\\chromium_installer.log.";
                        ecran = Ecran.Erreur;
                        debut = T;
                    }
                });
            });
            th.IsBackground = true;
            th.Start();
        }

        void Terminer()
        {
            if (Installation.Essai) { Close(); return; }
            Installation.Ouvrir();
            if (parDefaut && !dejaDefaut)
            {
                Thread.Sleep(1500); // la fenêtre de Windows par-dessus PouleyPwolu
                Installation.ChoisirParDefaut();
            }
            Close();
        }

        // ---- Souris ----

        string Cible(Point p)
        {
            foreach (KeyValuePair<string, RectangleF> z in zones)
                if (z.Value.Contains(p)) return z.Key;
            return null;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            string c = Cible(e.Location);
            if (c != survol) { survol = c; Cursor = c == null ? Cursors.Default : Cursors.Hand; }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            survol = null;
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            string c = Cible(e.Location);
            // Un clic dans la première seconde visait sans doute autre chose : la fenêtre
            // vient d'apparaître sous la souris. On ne déclenche rien.
            if (c != null && c != "fermer" && c != "reduire" && T - affichee < 1.0) return;            if (c == null)
            {
                // Déplacer la fenêtre en la tirant de n'importe où.
                ReleaseCapture();
                SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
                return;
            }
            switch (c)
            {
                case "fermer":
                case "fermer2":
                    if (ecran != Ecran.Installation) Close();
                    break;
                case "reduire":
                    WindowState = FormWindowState.Minimized;
                    break;
                case "defaut":
                    parDefaut = !parDefaut;
                    break;
                case "installer":
                    Lancer();
                    break;
                case "ouvrir":
                    Terminer();
                    break;
                case "reessayer":
                    Lancer();
                    break;
            }
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            // L'installation ne part que d'un clic (une touche Entrée restée enfoncée au
            // lancement ne doit rien déclencher).
            if (e.KeyCode == Keys.Escape && ecran != Ecran.Installation) Close();
            else if (e.KeyCode == Keys.Space && ecran == Ecran.Accueil && !dejaDefaut) parDefaut = !parDefaut;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Pas d'arrêt au milieu de l'installation.
            if (ecran == Ecran.Installation && e.CloseReason == CloseReason.UserClosing) e.Cancel = true;
            base.OnFormClosing(e);
        }

        // ---- Dessin ----

        Font F(FontFamily f, float taille) { return new Font(f, taille * k, FontStyle.Regular, GraphicsUnit.Pixel); }

        static GraphicsPath Arrondi(RectangleF r, float rayon)
        {
            GraphicsPath p = new GraphicsPath();
            float d = rayon * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        void Centre(Graphics g, string s, Font f, Color c, float y)
        {
            SizeF t = g.MeasureString(s, f, (int)(ClientSize.Width - 60 * k), StringFormat.GenericTypographic);
            using (SolidBrush b = new SolidBrush(c))
            using (StringFormat sf = new StringFormat(StringFormat.GenericTypographic))
            {
                sf.Alignment = StringAlignment.Center;
                g.DrawString(s, f, b, new RectangleF(30 * k, y, ClientSize.Width - 60 * k, t.Height + 4 * k), sf);
            }
        }

        void Bouton(Graphics g, string id, string texte, RectangleF r, bool principal)
        {
            bool s = survol == id;
            using (GraphicsPath p = Arrondi(r, 12 * k))
            {
                if (principal)
                {
                    using (SolidBrush b = new SolidBrush(s ? JauneClair : Jaune)) g.FillPath(b, p);
                }
                else
                {
                    using (SolidBrush b = new SolidBrush(s ? Color.FromArgb(0x33, 0x33, 0x38) : Panneau)) g.FillPath(b, p);
                    using (Pen pen = new Pen(Color.FromArgb(20, 255, 255, 255), k)) g.DrawPath(pen, p);
                }
            }
            using (Font f = F(onestGras, 15))
            using (SolidBrush b = new SolidBrush(principal ? Color.FromArgb(0x17, 0x14, 0x0A) : Clair))
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                g.DrawString(texte, f, b, r, sf);
            }
            zones[id] = r;
        }

        void Poule(Graphics g, float y, float saut)
        {
            float px = 5 * k, w = 24 * px;
            float x = (ClientSize.Width - w) / 2 + 6 * k;
            // Ombre au sol.
            float sol = y + 22 * px;
            using (SolidBrush b = new SolidBrush(Color.FromArgb(90, 0, 0, 0)))
                g.FillEllipse(b, x + 3 * px, sol - 2 * k, 14 * px - saut * 0.6f, 8 * k);
            Sprites.Dessiner(g, Sprites.Poule, x, y - saut, px, false);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            zones.Clear();
            float W = ClientSize.Width, Hh = ClientSize.Height;
            double t = T;

            // Fond : halo jaune derrière la poule, comme la page « Nouvel onglet ».
            g.Clear(Fond);
            using (GraphicsPath halo = new GraphicsPath())
            {
                RectangleF rh = new RectangleF(W / 2 - 260 * k, -150 * k, 520 * k, 380 * k);
                halo.AddEllipse(rh);
                using (PathGradientBrush b = new PathGradientBrush(halo))
                {
                    b.CenterColor = Color.FromArgb(ecran == Ecran.Erreur ? 0 : 34, 0xFF, 0xE1, 0x00);
                    b.SurroundColors = new Color[] { Color.FromArgb(0, 0xFF, 0xE1, 0x00) };
                    g.FillPath(b, halo);
                }
            }
            using (Pen p = new Pen(Color.FromArgb(22, 255, 255, 255), k)) g.DrawRectangle(p, 0, 0, W - 1, Hh - 1);

            // Barre du haut : nom, réduire, fermer.
            using (Font f = F(onestGras, 13))
            using (SolidBrush b = new SolidBrush(Discret))
                g.DrawString("PouleyPwolu", f, b, 18 * k, 14 * k);
            RectangleF rr = new RectangleF(W - 84 * k, 8 * k, 36 * k, 30 * k);
            RectangleF rf = new RectangleF(W - 44 * k, 8 * k, 36 * k, 30 * k);
            foreach (KeyValuePair<string, RectangleF> z in new[] { new KeyValuePair<string, RectangleF>("reduire", rr), new KeyValuePair<string, RectangleF>("fermer", rf) })
            {
                if (z.Key == "fermer" && ecran == Ecran.Installation) continue;
                if (survol == z.Key)
                    using (GraphicsPath p = Arrondi(z.Value, 8 * k))
                    using (SolidBrush b = new SolidBrush(z.Key == "fermer" ? Rouge : Panneau)) g.FillPath(b, p);
                float cx = z.Value.X + z.Value.Width / 2, cy = z.Value.Y + z.Value.Height / 2, d = 5 * k;
                using (Pen p = new Pen(survol == z.Key ? Clair : Discret, 1.4f * k))
                {
                    if (z.Key == "fermer") { g.DrawLine(p, cx - d, cy - d, cx + d, cy + d); g.DrawLine(p, cx - d, cy + d, cx + d, cy - d); }
                    else g.DrawLine(p, cx - d, cy, cx + d, cy);
                }
                zones[z.Key] = z.Value;
            }

            float bob = (float)(Math.Round(Math.Sin(t * 2.2) * 1.5) * k * 2); // flotte, par pixels entiers

            if (ecran == Ecran.Accueil)
            {
                Poule(g, 52 * k, Math.Max(0, bob));
                using (Font f = F(onestGras, 30)) Centre(g, miseAJour ? "Mettre à jour PouleyPwolu" : "Installer PouleyPwolu", f, Clair, 185 * k);
                using (Font f = F(onest, 15))
                    Centre(g, miseAJour ? "Tes poulaillers, onglets, favoris et réglages restent là."
                                        : "Le navigateur à plumes, sur un vrai Chromium.", f, Discret, 228 * k);

                float y = 268 * k;
                if (fermerPouley)
                {
                    using (Font f = F(onest, 13)) Centre(g, "PouleyPwolu est ouvert : il se fermera le temps de la mise à jour.", f, Jaune, y - 4 * k);
                    y += 22 * k;
                }
                if (!dejaDefaut)
                {
                    // Case « navigateur par défaut ».
                    string lib = "En faire mon navigateur par défaut";
                    using (Font f = F(onest, 15))
                    {
                        SizeF ts = g.MeasureString(lib, f);
                        float bw = 20 * k, total = bw + 10 * k + ts.Width;
                        float x = (W - total) / 2;
                        RectangleF caseR = new RectangleF(x, y + 2 * k, bw, bw);
                        using (GraphicsPath p = Arrondi(caseR, 5 * k))
                        {
                            if (parDefaut) { using (SolidBrush b = new SolidBrush(Jaune)) g.FillPath(b, p); }
                            else using (Pen pen = new Pen(survol == "defaut" ? Texte : Discret, 1.5f * k)) g.DrawPath(pen, p);
                        }
                        if (parDefaut)
                            using (Pen pen = new Pen(Color.FromArgb(0x17, 0x14, 0x0A), 2.2f * k))
                            {
                                pen.StartCap = pen.EndCap = LineCap.Round;
                                g.DrawLines(pen, new PointF[] {
                                    new PointF(caseR.X + 5 * k, caseR.Y + 10.5f * k),
                                    new PointF(caseR.X + 8.5f * k, caseR.Y + 14 * k),
                                    new PointF(caseR.X + 15 * k, caseR.Y + 6.5f * k) });
                            }
                        using (SolidBrush b = new SolidBrush(survol == "defaut" ? Clair : Texte))
                            g.DrawString(lib, f, b, x + bw + 10 * k, y);
                        zones["defaut"] = new RectangleF(x - 6 * k, y - 4 * k, total + 12 * k, 30 * k);
                    }
                }
                Bouton(g, "installer", miseAJour ? "Mettre à jour" : "Installer",
                    new RectangleF((W - 220 * k) / 2, Hh - 92 * k, 220 * k, 48 * k), true);
                using (Font f = F(mono, 11.5f))
                    Centre(g, (version.Length > 0 ? "Version " + version + "  ·  " : "") + "sans télémétrie  ·  ungoogled-chromium", f, Color.FromArgb(0x5E, 0x5E, 0x66), Hh - 30 * k);
            }
            else if (ecran == Ecran.Installation)
            {
                Poule(g, 52 * k, 0);
                using (Font f = F(onestGras, 30)) Centre(g, miseAJour ? "Mise à jour…" : "Installation…", f, Clair, 185 * k);
                string etape = progression < 0.06 ? (fermerPouley ? "On ferme PouleyPwolu un instant…" : "On prépare le poulailler…")
                    : progression < 0.55 ? "On installe Chromium…"
                    : progression < 0.9 ? "On range les plumes…" : "Encore un petit instant…";
                using (Font f = F(onest, 15)) Centre(g, etape, f, Discret, 228 * k);

                // Barre de progression, avec la poule qui court au bout.
                float bx = 70 * k, bw = W - 140 * k, by = Hh - 110 * k, bh = 10 * k;
                using (GraphicsPath p = Arrondi(new RectangleF(bx, by, bw, bh), bh / 2))
                using (SolidBrush b = new SolidBrush(Panneau)) g.FillPath(b, p);
                float fw = Math.Max(bh, (float)(bw * progression));
                using (GraphicsPath p = Arrondi(new RectangleF(bx, by, fw, bh), bh / 2))
                using (LinearGradientBrush b = new LinearGradientBrush(new RectangleF(bx, by, bw, bh), Color.FromArgb(0xFF, 0xC4, 0x00), Jaune, 0f))
                    g.FillPath(b, p);
                float rpx = 3 * k;
                int frame = (int)(t * 8) % 2;
                Sprites.Dessiner(g, Sprites.Course[frame], bx + fw - 10 * rpx, by - 15 * rpx, rpx, true);
                using (Font f = F(mono, 13))
                    Centre(g, ((int)Math.Round(progression * 100)) + " %", f, Discret, by + 24 * k);
            }
            else if (ecran == Ecran.Fini)
            {
                // Petit saut de joie.
                double s = t - debut;
                float saut = s < 1.2 ? (float)(Math.Abs(Math.Sin(s * Math.PI * 2.5)) * 14 * k * (1 - s / 1.2)) : Math.Max(0, bob);
                Poule(g, 52 * k, saut);
                using (Font f = F(onestGras, 30)) Centre(g, "C'est prêt !", f, Clair, 185 * k);
                string sous = parDefaut && !dejaDefaut
                    ? "Il ne reste qu'à le choisir dans le réglage de Windows."
                    : miseAJour ? "PouleyPwolu est à jour." : "PouleyPwolu est installé. Bon vol !";
                using (Font f = F(onest, 15)) Centre(g, sous, f, Discret, 228 * k);
                Bouton(g, "ouvrir", "Ouvrir PouleyPwolu",
                    new RectangleF((W - 240 * k) / 2, Hh - 92 * k, 240 * k, 48 * k), true);
            }
            else
            {
                Poule(g, 52 * k, 0);
                using (Font f = F(onestGras, 26)) Centre(g, "L'installation n'a pas abouti", f, Clair, 185 * k);
                using (Font f = F(onest, 14)) Centre(g, erreur, f, Discret, 226 * k);
                Bouton(g, "reessayer", "Réessayer", new RectangleF(W / 2 - 210 * k, Hh - 92 * k, 200 * k, 48 * k), true);
                Bouton(g, "fermer2", "Fermer", new RectangleF(W / 2 + 10 * k, Hh - 92 * k, 200 * k, 48 * k), false);
            }
        }
    }
}
