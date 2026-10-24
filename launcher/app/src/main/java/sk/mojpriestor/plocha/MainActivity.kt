package sk.mojpriestor.plocha

import android.app.Activity
import android.app.ActivityOptions
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.UserHandle
import android.provider.MediaStore
import android.provider.Settings
import android.provider.Telephony
import android.text.Editable
import android.text.TextUtils
import android.text.TextWatcher
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ScrollView
import android.widget.TextClock
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import java.util.concurrent.Executors
import kotlin.math.abs

class MainActivity : Activity() {

    private val prefs by lazy { getSharedPreferences("plocha", MODE_PRIVATE) }
    private val launcherApps by lazy { getSystemService(LauncherApps::class.java) }
    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var board: Board
    private var apps: List<AppEntry> = emptyList()
    private var byKey: Map<String, AppEntry> = emptyMap()
    private var byPkg: Map<String, AppEntry> = emptyMap()
    private var loaded = false

    private lateinit var root: FrameLayout
    private lateinit var content: LinearLayout
    private lateinit var clock: TextClock
    private lateinit var date: TextClock
    private lateinit var modeBar: LinearLayout
    private lateinit var panelsRow: LinearLayout
    private lateinit var spacer: View
    private lateinit var restoreBar: View
    private lateinit var bottomBar: View
    private lateinit var drawer: LinearLayout
    private lateinit var drawerList: LinearLayout
    private lateinit var search: EditText
    private lateinit var gestures: GestureDetector

    private val scrolls = arrayOfNulls<ScrollView>(2)
    private val scrollY = IntArray(2)

    private val packageCallback = object : LauncherApps.Callback() {
        override fun onPackageRemoved(packageName: String, user: UserHandle) = reloadApps()
        override fun onPackageAdded(packageName: String, user: UserHandle) = reloadApps()
        override fun onPackageChanged(packageName: String, user: UserHandle) = reloadApps()
        override fun onPackagesAvailable(packageNames: Array<String>, user: UserHandle, replacing: Boolean) = reloadApps()
        override fun onPackagesUnavailable(packageNames: Array<String>, user: UserHandle, replacing: Boolean) = reloadApps()
    }

    // ---------------------------------------------------------------- životný cyklus

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        board = Board.load(prefs)
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        buildUi()
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
        gestures = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
                if (e1 == null || board.minimized) return false
                val dx = e2.x - e1.x
                val dy = e2.y - e1.y
                if (abs(dx) < dp(90) || abs(dx) < abs(dy) * 1.5f) return false
                // potiahnutie doľava ukáže pravú plochu a naopak
                val target = if (dx < 0) 1 else 0
                if (board.mode == MODE_SPLIT) setActive(target) else setMode(if (target == 0) MODE_LEFT else MODE_RIGHT)
                return true
            }
        })
        gestures.setIsLongpressEnabled(false)
        launcherApps.registerCallback(packageCallback, ui)
        render()
        reloadApps()
    }

    override fun onDestroy() {
        launcherApps.unregisterCallback(packageCallback)
        io.shutdown()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // tlačidlo Domov na ploche zavrie zoznam aplikácií
        closeDrawer()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        render()
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        handleBack()
    }

    private fun handleBack() {
        if (drawer.visibility == View.VISIBLE) closeDrawer()
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (drawer.visibility != View.VISIBLE) gestures.onTouchEvent(ev)
        return super.dispatchTouchEvent(ev)
    }

    // ---------------------------------------------------------------- aplikácie

    private fun reloadApps() {
        io.execute {
            val list = try {
                Apps.load(this)
            } catch (e: Exception) {
                emptyList()
            }
            ui.post { applyApps(list) }
        }
    }

    private fun applyApps(list: List<AppEntry>) {
        if (list.isEmpty()) return
        apps = list
        byKey = list.associateBy { it.key }
        byPkg = list.associateBy { it.pkg }
        loaded = true
        if (!board.initialized) {
            Sorter.autoSort(board, list, favoritePackages())
            board.initialized = true
        } else {
            val fresh = list.filter { it.key !in board.known && locate(it) == null }
            if (fresh.isNotEmpty()) {
                val panel = board.panels[0]
                val section = panel.sections.firstOrNull { it.name == Sorter.NEW }
                    ?: Section(Sorter.NEW).also { panel.sections.add(0, it) }
                section.collapsed = false
                fresh.forEach { section.apps.add(it.key) }
            }
        }
        board.known.addAll(list.map { it.key })
        save()
        render()
        if (drawer.visibility == View.VISIBLE) renderDrawer()
    }

    private fun favoritePackages(): List<String> {
        fun resolve(intent: Intent): String? = try {
            @Suppress("DEPRECATION")
            packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
                ?.activityInfo?.packageName?.takeIf { it != "android" }
        } catch (e: Exception) {
            null
        }
        return listOfNotNull(
            resolve(Intent(Intent.ACTION_DIAL)),
            Telephony.Sms.getDefaultSmsPackage(this),
            resolve(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)),
            resolve(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))),
            "sk.mojpriestor.app",
            "sk.mojpriestor.elektro",
        )
    }

    /** kľúč uložený v sekcii -> nainštalovaná aplikácia (ak sa zmenila hlavná aktivita, nájde ju podľa balíka) */
    private fun find(key: String): AppEntry? = byKey[key] ?: byPkg[key.substringBefore('/')]

    private fun locate(app: AppEntry): Pair<Int, Int>? {
        board.panels.forEachIndexed { pi, p ->
            p.sections.forEachIndexed { si, s -> if (s.apps.any { find(it) === app }) return pi to si }
        }
        return null
    }

    private fun locationLabel(app: AppEntry): String? =
        locate(app)?.let { (pi, si) -> board.panels[pi].name + " › " + board.panels[pi].sections[si].name }

    private fun removeEverywhere(app: AppEntry) {
        board.panels.forEach { p -> p.sections.forEach { s -> s.apps.removeAll { find(it) === app } } }
    }

    private fun addTo(app: AppEntry, pi: Int, si: Int) {
        removeEverywhere(app)
        board.panels[pi].sections[si].apps.add(app.key)
    }

    private fun launch(app: AppEntry, from: View?) {
        try {
            var bounds: Rect? = null
            var options: Bundle? = null
            if (from != null && from.isAttachedToWindow) {
                val loc = IntArray(2)
                from.getLocationOnScreen(loc)
                bounds = Rect(loc[0], loc[1], loc[0] + from.width, loc[1] + from.height)
                options = ActivityOptions.makeClipRevealAnimation(from, 0, 0, from.width, from.height).toBundle()
            }
            launcherApps.startMainActivity(app.component, app.user, bounds, options)
        } catch (e: Exception) {
            toast("Aplikáciu „${app.label}“ sa nepodarilo spustiť")
        }
    }

    private fun save() = board.save(prefs)

    // ---------------------------------------------------------------- stavba obrazovky

    private fun buildUi() {
        root = FrameLayout(this)

        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        clock = TextClock(this).apply {
            format24Hour = "HH:mm"
            format12Hour = "HH:mm"
            setTextColor(TEXT)
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setShadowLayer(8f, 0f, 2f, SHADOW)
        }
        date = TextClock(this).apply {
            format24Hour = "EEEE d. MMMM"
            format12Hour = "EEEE d. MMMM"
            setTextColor(MUTED)
            textSize = 14f
            setShadowLayer(6f, 0f, 1f, SHADOW)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(6), dp(4), dp(6), dp(10))
            addView(clock)
            addView(date)
            setOnClickListener { if (board.minimized) setMinimized(false) }
        }
        content.addView(header)

        modeBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        content.addView(modeBar, lp(MATCH, WRAP).apply { bottomMargin = dp(10) })

        panelsRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        content.addView(panelsRow, lp(MATCH, 0, 1f))

        spacer = View(this)
        content.addView(spacer, lp(MATCH, 0, 1f))

        restoreBar = pill("▣  Zobraziť plochu") { setMinimized(false) }
        content.addView(restoreBar, lp(WRAP, WRAP).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(10)
        })

        bottomBar = pill("⌕  Všetky aplikácie") { openDrawer() }
        content.addView(bottomBar, lp(WRAP, WRAP).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(10)
        })

        root.addView(content, FrameLayout.LayoutParams(MATCH, MATCH))

        drawer = buildDrawer()
        root.addView(drawer, FrameLayout.LayoutParams(MATCH, MATCH))

        root.setOnApplyWindowInsetsListener { _, insets -> applyInsets(insets); insets }
    }

    @Suppress("DEPRECATION")
    private fun applyInsets(insets: WindowInsets) {
        // ľavý, horný, pravý, dolný okraj systémových líšt a výška klávesnice
        val (l, t, r, b, ime) = if (Build.VERSION.SDK_INT >= 30) {
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            listOf(bars.left, bars.top, bars.right, bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom)
        } else {
            listOf(
                insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom, 0,
            )
        }
        content.setPadding(l + dp(12), t + dp(8), r + dp(12), b + dp(10))
        drawer.setPadding(l + dp(12), t + dp(12), r + dp(12), maxOf(b, ime) + dp(8))
    }

    private fun render() {
        for (i in 0..1) scrolls[i]?.let { scrollY[i] = it.scrollY }
        scrolls.fill(null)

        root.setBackgroundColor(if (board.wallpaper) SCRIM else BG)
        clock.textSize = if (board.minimized) 76f else 46f
        renderModeBar()

        panelsRow.removeAllViews()
        val minimized = board.minimized
        panelsRow.visibility = if (minimized) View.GONE else View.VISIBLE
        modeBar.visibility = if (minimized) View.GONE else View.VISIBLE
        spacer.visibility = if (minimized) View.VISIBLE else View.GONE
        restoreBar.visibility = if (minimized) View.VISIBLE else View.GONE

        if (!minimized) {
            val shown = when (board.mode) {
                MODE_LEFT -> listOf(0)
                MODE_RIGHT -> listOf(1)
                else -> listOf(0, 1)
            }
            val split = shown.size == 2
            shown.forEachIndexed { n, pi ->
                // pri dvoch plochách je aktívna o trochu širšia
                val weight = if (split && pi == board.active) 1.2f else 1f
                panelsRow.addView(panelView(pi, split), lp(0, MATCH, weight).apply { if (n > 0) marginStart = dp(8) })
            }
        }
        for (i in 0..1) {
            val y = scrollY[i]
            scrolls[i]?.let { s -> s.post { s.scrollTo(0, y) } }
        }
    }

    private fun renderModeBar() {
        modeBar.removeAllViews()
        val segment = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = rounded(SURFACE, dp(14), BORDER)
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        listOf(
            MODE_LEFT to board.panels[0].name,
            MODE_SPLIT to "Obe",
            MODE_RIGHT to board.panels[1].name,
        ).forEach { (mode, label) ->
            val selected = board.mode == mode
            segment.addView(TextView(this).apply {
                text = label
                textSize = 13f
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                maxWidth = dp(110)
                setTextColor(if (selected) TEXT else MUTED)
                if (selected) {
                    setTypeface(typeface, Typeface.BOLD)
                    background = rounded(ACCENT, dp(11))
                }
                setPadding(dp(12), dp(7), dp(12), dp(7))
                setOnClickListener { setMode(mode) }
            })
        }
        modeBar.addView(segment)
        modeBar.addView(View(this), lp(0, 1, 1f))
        modeBar.addView(roundButton("⇄") { switchPanels() })
        modeBar.addView(roundButton("—") { setMinimized(true) }, lp(WRAP, WRAP).apply { marginStart = dp(6) })
        val more = roundButton("⋮") {}
        more.setOnClickListener { mainMenu(it) }
        modeBar.addView(more, lp(WRAP, WRAP).apply { marginStart = dp(6) })
    }

    private fun panelView(pi: Int, split: Boolean): View {
        val panel = board.panels[pi]
        val highlighted = split && board.active == pi
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(SURFACE, dp(20), if (highlighted) ACCENT else BORDER, if (highlighted) dp(2) else dp(1))
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(4), dp(2), dp(4))
            setOnClickListener { setActive(pi) }
            setOnLongClickListener { panelMenu(pi, it); true }
        }
        header.addView(text(panel.name, 15f, TEXT, bold = true).apply {
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }, lp(0, WRAP, 1f))
        header.addView(roundButton("+", small = true) { addSection(pi) })
        box.addView(header)

        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (!loaded) {
            list.addView(hint("Načítavam aplikácie…"))
        } else if (panel.sections.isEmpty()) {
            list.addView(hint("Zatiaľ tu nie je žiadna sekcia.\nŤukni sem a pridaj ju.") { addSection(pi) })
        }
        val cols = if (split) board.colsSplit else board.colsSingle
        if (loaded) panel.sections.forEachIndexed { si, s -> list.addView(sectionView(pi, si, s, cols, split)) }

        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(list)
        }
        scrolls[pi] = scroll
        box.addView(scroll, lp(MATCH, 0, 1f))
        return box
    }

    private fun sectionView(pi: Int, si: Int, s: Section, cols: Int, split: Boolean): View {
        val entries = s.apps.mapNotNull { find(it) }.distinct()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(2))
        }

        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(SECTION, dp(12))
            setPadding(dp(8), dp(6), dp(4), dp(6))
            setOnClickListener {
                s.collapsed = !s.collapsed
                save()
                render()
            }
            setOnLongClickListener { sectionMenu(pi, si, it); true }
        }
        head.addView(text(if (s.collapsed) "▸" else "▾", 13f, ACCENT_LIGHT), lp(dp(16), WRAP))
        head.addView(text(s.name, 13f, TEXT, bold = true).apply {
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }, lp(0, WRAP, 1f))
        if (s.collapsed) {
            // zbalená sekcia sa správa ako priečinok – ukáže náhľad prvých ikon
            entries.take(if (split) 3 else 5).forEach { app ->
                head.addView(ImageView(this).apply { setImageDrawable(app.icon) }, lp(dp(18), dp(18)).apply { marginStart = dp(2) })
            }
        }
        head.addView(text(entries.size.toString(), 11f, MUTED).apply { setPadding(dp(6), 0, dp(2), 0) })
        head.addView(text("⋯", 16f, MUTED).apply {
            setPadding(dp(6), 0, dp(6), 0)
            setOnClickListener { sectionMenu(pi, si, it) }
        })
        box.addView(head)

        if (!s.collapsed) {
            if (entries.isEmpty()) {
                box.addView(hint("Prázdna sekcia – ťukni a vyber aplikácie") { pickApps(pi, si) })
            } else {
                val iconSize = if (split) 42 else 50
                entries.chunked(cols).forEach { row ->
                    val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    row.forEach { app -> line.addView(tile(app, pi, si, iconSize, split), lp(0, WRAP, 1f)) }
                    repeat(cols - row.size) { line.addView(View(this), lp(0, 1, 1f)) }
                    box.addView(line)
                }
            }
        }
        return box
    }

    private fun tile(app: AppEntry, pi: Int, si: Int, iconDp: Int, split: Boolean): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(2), dp(7), dp(2), dp(5))
            setBackgroundResource(selectable())
            addView(ImageView(this@MainActivity).apply { setImageDrawable(app.icon) }, lp(dp(iconDp), dp(iconDp)))
            addView(text(app.label, if (split) 10.5f else 11.5f, TEXT).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                gravity = Gravity.CENTER_HORIZONTAL
                setShadowLayer(4f, 0f, 1f, SHADOW)
                setPadding(0, dp(4), 0, 0)
            }, lp(MATCH, WRAP))
            setOnClickListener {
                if (board.active != pi) {
                    board.active = pi
                    save()
                }
                launch(app, this)
            }
            setOnLongClickListener { appMenu(app, it, pi, si); true }
        }

    // ---------------------------------------------------------------- prepínanie

    private fun setMode(mode: Int) {
        board.mode = mode
        if (mode == MODE_LEFT) board.active = 0
        if (mode == MODE_RIGHT) board.active = 1
        save()
        render()
    }

    private fun setActive(pi: Int) {
        if (board.active == pi) return
        board.active = pi
        save()
        render()
    }

    private fun switchPanels() {
        when (board.mode) {
            MODE_SPLIT -> setActive(1 - board.active)
            MODE_LEFT -> setMode(MODE_RIGHT)
            else -> setMode(MODE_LEFT)
        }
    }

    private fun setMinimized(value: Boolean) {
        board.minimized = value
        save()
        render()
    }

    // ---------------------------------------------------------------- menu

    private fun mainMenu(anchor: View) {
        val m = PopupMenu(this, anchor)
        m.menu.add(0, 1, 0, "Pridať sekciu")
        m.menu.add(0, 2, 0, "Vymeniť plochy (ľavá ↔ pravá)")
        m.menu.add(0, 3, 0, "Stĺpce pri dvoch plochách: ${board.colsSplit}")
        m.menu.add(0, 4, 0, "Stĺpce pri jednej ploche: ${board.colsSingle}")
        m.menu.add(0, 5, 0, if (board.wallpaper) "Pozadie: tapeta → tmavé" else "Pozadie: tmavé → tapeta")
        m.menu.add(0, 6, 0, "Dve aplikácie naraz – ako na to")
        m.menu.add(0, 7, 0, "Znova roztriediť automaticky…")
        m.menu.add(0, 8, 0, "Nastaviť ako predvolenú plochu")
        m.menu.add(0, 9, 0, "Nastavenia telefónu")
        m.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> addSection(board.active)
                2 -> {
                    board.panels.add(board.panels.removeAt(0))
                    board.active = 1 - board.active
                    save()
                    render()
                }
                3 -> chooseNumber("Stĺpce pri dvoch plochách", listOf(2, 3, 4), board.colsSplit) { board.colsSplit = it }
                4 -> chooseNumber("Stĺpce pri jednej ploche", listOf(4, 5, 6), board.colsSingle) { board.colsSingle = it }
                5 -> {
                    board.wallpaper = !board.wallpaper
                    save()
                    render()
                }
                6 -> dialog().setTitle("Dve aplikácie naraz")
                    .setMessage(
                        "Moja plocha ti ukáže dve plochy vedľa seba. Ak chceš mať vedľa seba dve spustené " +
                            "aplikácie, HyperOS to robí sám:\n\n" +
                            "1. Otvor obe aplikácie.\n" +
                            "2. Ťukni na tlačidlo ■ (nedávne aplikácie).\n" +
                            "3. Podrž kartu prvej aplikácie a vyber „Rozdelená obrazovka“.\n" +
                            "4. Ťukni na druhú aplikáciu.",
                    )
                    .setPositiveButton("OK", null).show()
                7 -> dialog().setTitle("Roztriediť znova?")
                    .setMessage("Tvoje sekcie a poradie sa zmažú a aplikácie sa znova rozdelia podľa kategórií.")
                    .setPositiveButton("Roztriediť") { _, _ ->
                        Sorter.autoSort(board, apps, favoritePackages())
                        save()
                        render()
                    }
                    .setNegativeButton("Zrušiť", null).show()
                8 -> openSettings(Settings.ACTION_HOME_SETTINGS)
                9 -> openSettings(Settings.ACTION_SETTINGS)
            }
            true
        }
        m.show()
    }

    private fun panelMenu(pi: Int, anchor: View) {
        val panel = board.panels[pi]
        val m = PopupMenu(this, anchor)
        m.menu.add(0, 1, 0, "Premenovať plochu")
        m.menu.add(0, 2, 0, "Pridať sekciu")
        m.menu.add(0, 3, 0, "Zbaliť všetky sekcie")
        m.menu.add(0, 4, 0, "Rozbaliť všetky sekcie")
        m.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> prompt("Názov plochy", panel.name) { panel.name = it; save(); render() }
                2 -> addSection(pi)
                3, 4 -> {
                    panel.sections.forEach { it.collapsed = item.itemId == 3 }
                    save()
                    render()
                }
            }
            true
        }
        m.show()
    }

    private fun sectionMenu(pi: Int, si: Int, anchor: View) {
        val panel = board.panels[pi]
        val s = panel.sections[si]
        val other = board.panels[1 - pi]
        val m = PopupMenu(this, anchor)
        m.menu.add(0, 1, 0, "Vybrať aplikácie…")
        m.menu.add(0, 2, 0, "Premenovať")
        if (si > 0) m.menu.add(0, 3, 0, "Posunúť vyššie")
        if (si < panel.sections.size - 1) m.menu.add(0, 4, 0, "Posunúť nižšie")
        m.menu.add(0, 5, 0, "Presunúť na „${other.name}“")
        m.menu.add(0, 6, 0, "Zoradiť podľa abecedy")
        m.menu.add(0, 7, 0, "Vymazať sekciu")
        m.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> pickApps(pi, si)
                2 -> prompt("Názov sekcie", s.name) { s.name = it; save(); render() }
                3 -> { panel.sections.add(si - 1, panel.sections.removeAt(si)); save(); render() }
                4 -> { panel.sections.add(si + 1, panel.sections.removeAt(si)); save(); render() }
                5 -> { other.sections.add(panel.sections.removeAt(si)); save(); render() }
                6 -> {
                    val sorted = s.apps.sortedBy { key -> find(key)?.let { apps.indexOf(it) } ?: Int.MAX_VALUE }
                    s.apps.clear()
                    s.apps.addAll(sorted)
                    save()
                    render()
                }
                7 -> dialog().setTitle("Vymazať „${s.name}“?")
                    .setMessage("Aplikácie zostanú v telefóne, nájdeš ich vo „Všetky aplikácie“.")
                    .setPositiveButton("Vymazať") { _, _ -> panel.sections.removeAt(si); save(); render() }
                    .setNegativeButton("Zrušiť", null).show()
            }
            true
        }
        m.show()
    }

    /** si = -1, ak sa menu otvorilo zo zoznamu všetkých aplikácií */
    private fun appMenu(app: AppEntry, anchor: View, pi: Int, si: Int) {
        val m = PopupMenu(this, anchor)
        m.menu.add(0, 1, 0, if (si >= 0) "Presunúť do sekcie…" else "Pridať do sekcie…")
        if (si >= 0) {
            m.menu.add(0, 2, 0, "◀ Posunúť dopredu")
            m.menu.add(0, 3, 0, "Posunúť dozadu ▶")
            m.menu.add(0, 4, 0, "Na začiatok sekcie")
            m.menu.add(0, 5, 0, "Odobrať zo sekcie")
        }
        m.menu.add(0, 6, 0, "Informácie o aplikácii")
        m.menu.add(0, 7, 0, "Odinštalovať")
        m.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> pickSection("Kam dať „${app.label}“?") { tp, ts -> addTo(app, tp, ts); changed() }
                2, 3, 4 -> {
                    val list = board.panels[pi].sections[si].apps
                    val i = list.indexOfFirst { find(it) === app }
                    if (i >= 0) {
                        val target = when (item.itemId) {
                            2 -> maxOf(0, i - 1)
                            3 -> minOf(list.size - 1, i + 1)
                            else -> 0
                        }
                        list.add(target, list.removeAt(i))
                        changed()
                    }
                }
                5 -> { removeEverywhere(app); changed() }
                6 -> try {
                    launcherApps.startAppDetailsActivity(app.component, app.user, null, null)
                } catch (e: Exception) {
                    toast("Nedá sa otvoriť")
                }
                7 -> try {
                    startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:${app.pkg}")))
                } catch (e: Exception) {
                    toast("Nedá sa odinštalovať")
                }
            }
            true
        }
        m.show()
    }

    private fun changed() {
        save()
        render()
        if (drawer.visibility == View.VISIBLE) renderDrawer()
    }

    // ---------------------------------------------------------------- dialógy

    private fun addSection(pi: Int) {
        prompt("Nová sekcia na „${board.panels[pi].name}“", "") { name ->
            board.panels[pi].sections.add(Section(name))
            if (board.mode != MODE_SPLIT) setMode(if (pi == 0) MODE_LEFT else MODE_RIGHT)
            save()
            render()
            pickApps(pi, board.panels[pi].sections.size - 1)
        }
    }

    /** výber aplikácií do sekcie – zaškrtnuté sa do nej presunú, odškrtnuté z nej vypadnú */
    private fun pickApps(pi: Int, si: Int) {
        if (apps.isEmpty()) return
        val section = board.panels[pi].sections[si]
        val inSection = section.apps.mapNotNull { find(it) }.toSet()
        val labels = apps.map { app ->
            val where = if (app in inSection) null else locationLabel(app)
            if (where == null) app.label else "${app.label}   · $where"
        }.toTypedArray()
        val checked = BooleanArray(apps.size) { apps[it] in inSection }
        dialog().setTitle(section.name)
            .setMultiChoiceItems(labels, checked) { _, which, isChecked -> checked[which] = isChecked }
            .setPositiveButton("Uložiť") { _, _ ->
                apps.forEachIndexed { i, app ->
                    val was = app in inSection
                    if (checked[i] && !was) addTo(app, pi, si)
                    if (!checked[i] && was) section.apps.removeAll { find(it) === app }
                }
                changed()
            }
            .setNegativeButton("Zrušiť", null)
            .show()
    }

    private fun pickSection(title: String, onPick: (Int, Int) -> Unit) {
        val targets = mutableListOf<Pair<Int, Int>>()
        val labels = mutableListOf<String>()
        board.panels.forEachIndexed { pi, p ->
            p.sections.forEachIndexed { si, s ->
                targets.add(pi to si)
                labels.add(p.name + " › " + s.name)
            }
        }
        labels.add("＋ Nová sekcia…")
        dialog().setTitle(title)
            .setItems(labels.toTypedArray()) { _, which ->
                if (which < targets.size) {
                    val (pi, si) = targets[which]
                    onPick(pi, si)
                } else {
                    val pi = board.active
                    prompt("Nová sekcia na „${board.panels[pi].name}“", "") { name ->
                        board.panels[pi].sections.add(Section(name))
                        onPick(pi, board.panels[pi].sections.size - 1)
                    }
                }
            }
            .setNegativeButton("Zrušiť", null)
            .show()
    }

    private fun prompt(title: String, initial: String, onOk: (String) -> Unit) {
        val input = EditText(this).apply {
            setText(initial)
            setSingleLine()
            setSelection(text.length)
        }
        val frame = FrameLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input)
        }
        val d = dialog().setTitle(title)
            .setView(frame)
            .setPositiveButton("OK") { _, _ ->
                val value = input.text.toString().trim()
                if (value.isNotEmpty()) onOk(value)
            }
            .setNegativeButton("Zrušiť", null)
            .create()
        d.setOnShowListener {
            input.requestFocus()
            input.postDelayed({
                getSystemService(InputMethodManager::class.java).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
            }, 150)
        }
        d.show()
    }

    private fun chooseNumber(title: String, options: List<Int>, current: Int, onPick: (Int) -> Unit) {
        dialog().setTitle(title)
            .setSingleChoiceItems(options.map { it.toString() }.toTypedArray(), options.indexOf(current)) { d, which ->
                onPick(options[which])
                save()
                render()
                d.dismiss()
            }
            .show()
    }

    private fun dialog() = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)

    private fun openSettings(action: String) {
        try {
            startActivity(Intent(action))
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    // ---------------------------------------------------------------- všetky aplikácie

    private fun buildDrawer(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(DRAWER_BG)
            visibility = View.GONE
            isClickable = true
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        search = EditText(this).apply {
            hint = "Hľadať aplikáciu…"
            setHintTextColor(MUTED)
            setTextColor(TEXT)
            textSize = 16f
            setSingleLine()
            imeOptions = EditorInfo.IME_ACTION_GO
            background = rounded(SURFACE, dp(16), BORDER)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) = renderDrawer()
            })
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_GO) {
                    filtered().firstOrNull()?.let { launch(it, null); closeDrawer() }
                    true
                } else {
                    false
                }
            }
        }
        top.addView(search, lp(0, WRAP, 1f))
        top.addView(roundButton("✕") { closeDrawer() }, lp(WRAP, WRAP).apply { marginStart = dp(8) })
        box.addView(top)

        drawerList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(drawerList)
        }
        box.addView(scroll, lp(MATCH, 0, 1f).apply { topMargin = dp(10) })
        return box
    }

    private fun filtered(): List<AppEntry> {
        val q = Apps.norm(search.text.toString().trim())
        return if (q.isEmpty()) apps else apps.filter { Apps.norm(it.label).contains(q) }
    }

    private fun renderDrawer() {
        drawerList.removeAllViews()
        val list = filtered()
        if (list.isEmpty()) {
            drawerList.addView(hint(if (loaded) "Nič sa nenašlo" else "Načítavam aplikácie…"))
            return
        }
        list.forEach { app ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(8), dp(8), dp(8), dp(8))
                setBackgroundResource(selectable())
                setOnClickListener {
                    launch(app, this)
                    closeDrawer()
                }
                setOnLongClickListener { appMenu(app, it, -1, -1); true }
            }
            row.addView(ImageView(this).apply { setImageDrawable(app.icon) }, lp(dp(40), dp(40)))
            val texts = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), 0, 0, 0)
                addView(text(app.label, 15f, TEXT))
                addView(text(locationLabel(app) ?: "nezaradená", 12f, if (locate(app) == null) ACCENT_LIGHT else MUTED))
            }
            row.addView(texts, lp(0, WRAP, 1f))
            drawerList.addView(row)
        }
    }

    private fun openDrawer() {
        search.setText("")
        renderDrawer()
        drawer.visibility = View.VISIBLE
    }

    private fun closeDrawer() {
        if (!::drawer.isInitialized || drawer.visibility != View.VISIBLE) return
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(search.windowToken, 0)
        search.clearFocus()
        drawer.visibility = View.GONE
    }

    // ---------------------------------------------------------------- pomocníci

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun lp(w: Int, h: Int, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)

    private fun rounded(color: Int, radius: Int, stroke: Int? = null, strokeWidth: Int = dp(1)) =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius.toFloat()
            if (stroke != null) setStroke(strokeWidth, stroke)
        }

    private fun selectable(): Int {
        val tv = TypedValue()
        theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        return tv.resourceId
    }

    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    private fun hint(value: String, onClick: (() -> Unit)? = null) = text(value, 12f, MUTED).apply {
        gravity = Gravity.CENTER
        setPadding(dp(8), dp(14), dp(8), dp(14))
        if (onClick != null) setOnClickListener { onClick() }
    }

    private fun pill(label: String, onClick: () -> Unit) = text(label, 14f, TEXT, bold = true).apply {
        background = rounded(SURFACE_STRONG, dp(22), BORDER)
        setPadding(dp(22), dp(11), dp(22), dp(11))
        setOnClickListener { onClick() }
    }

    private fun roundButton(label: String, small: Boolean = false, onClick: () -> Unit) =
        text(label, if (small) 18f else 16f, TEXT, bold = true).apply {
            gravity = Gravity.CENTER
            val size = dp(if (small) 30 else 38)
            minWidth = size
            minHeight = size
            background = rounded(if (small) SECTION else SURFACE_STRONG, size / 2, if (small) null else BORDER)
            setOnClickListener { onClick() }
        }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

        // farby z Môjho priestoru (public/css/theme.css)
        private const val BG = 0xFF07070D.toInt()
        private const val DRAWER_BG = 0xF507070D.toInt()
        private const val SCRIM = 0x55000000
        private const val SURFACE = 0x8C13131D.toInt()
        private const val SURFACE_STRONG = 0xCC13131D.toInt()
        private const val SECTION = 0x14FFFFFF
        private const val BORDER = 0x17FFFFFF
        private const val TEXT = 0xFFF4F4F8.toInt()
        private const val MUTED = 0xFF9A9AB0.toInt()
        private const val ACCENT = 0xFF8B5CF6.toInt()
        private const val ACCENT_LIGHT = 0xFFB79CFF.toInt()
        private const val SHADOW = 0x99000000.toInt()
    }
}
