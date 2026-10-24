package sk.mojpriestor.plocha

import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.LauncherApps
import android.graphics.drawable.Drawable
import android.os.Process
import android.os.UserHandle
import java.text.Collator
import java.text.Normalizer
import java.util.Locale

class AppEntry(
    val key: String,
    val label: String,
    val component: ComponentName,
    val user: UserHandle,
    val category: Int,
    val icon: Drawable,
) {
    val pkg: String get() = component.packageName
}

object Apps {
    /** Všetky spustiteľné aplikácie zoradené podľa slovenskej abecedy (volať mimo hlavného vlákna). */
    fun load(ctx: Context): List<AppEntry> {
        val launcherApps = ctx.getSystemService(LauncherApps::class.java)
        val collator = Collator.getInstance(Locale.forLanguageTag("sk"))
        return launcherApps.getActivityList(null, Process.myUserHandle())
            .filter { it.componentName.packageName != ctx.packageName }
            .map { info ->
                AppEntry(
                    key = info.componentName.flattenToShortString(),
                    label = info.label?.toString()?.trim().orEmpty().ifEmpty { info.componentName.packageName },
                    component = info.componentName,
                    user = info.user,
                    category = info.applicationInfo.category,
                    icon = info.getBadgedIcon(0),
                )
            }
            .sortedWith { a, b -> collator.compare(a.label, b.label) }
    }

    /** text bez diakritiky a malými písmenami – na hľadanie */
    fun norm(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()
}

/** Prvotné roztriedenie aplikácií do sekcií na dvoch plochách. */
object Sorter {
    const val FAVORITES = "Obľúbené"
    const val OTHER = "Ostatné"
    const val NEW = "Nové"

    private val leftPanel = listOf(FAVORITES, "Komunikácia", "Sociálne", "Práca", "Financie", "Nákupy")
    private val rightPanel = listOf("Médiá", "Hry", "Správy", "Cestovanie", "Nástroje", OTHER)
    private val startCollapsed = setOf("Nástroje", OTHER)

    // hľadá sa v názve balíka aj v názve aplikácie (bez diakritiky), prvá zhoda vyhráva
    private val rules = listOf(
        "Komunikácia" to listOf(
            "whatsapp", "messenger", "facebook.orca", "telegram", "viber", "signal", "skype", "discord",
            "dialer", "incallui", "contacts", "kontakty", "mms", "messaging", "spravy", "gmail", "mail",
            "teams", "zoom", "telefon",
        ),
        "Sociálne" to listOf(
            "facebook", "instagram", "tiktok", "musically", "twitter", "snapchat", "linkedin", "reddit",
            "pinterest", "threads",
        ),
        "Práca" to listOf(
            "office", "docs", "sheets", "slides", "drive", "word", "excel", "powerpoint", "pdf", "notion",
            "keep", "onenote", "outlook", "calendar", "kalendar", "notes", "poznam", "todo", "trello",
            "github", "claude", "anthropic", "chatgpt", "openai", "gemini", "mojpriestor",
        ),
        "Financie" to listOf(
            "bank", "tatra", "vub", "slsp", "csob", "unicredit", "mbank", "revolut", "paypal", "wallet",
            "george", "payments", "googlepay",
        ),
        "Nákupy" to listOf(
            "alza", "temu", "aliexpress", "shein", "amazon", "ebay", "bazos", "lidl", "kaufland", "tesco",
            "wolt", "glovo", "foodpanda", "vinted",
        ),
        "Médiá" to listOf(
            "camera", "fotoapar", "gallery", "galeria", "photos", "fotky", "music", "hudba", "video",
            "youtube", "spotify", "netflix", "player", "podcast", "radio", "voyo", "hbo", "disney", "twitch",
            "recorder", "diktafon",
        ),
        "Cestovanie" to listOf(
            "maps", "mapy", "waze", "uber", "bolt", "booking", "airbnb", "ryanair", "zssk", "idos", "navig",
        ),
        "Nástroje" to listOf(
            "settings", "nastaven", "securitycenter", "cleaner", "filemanager", "fileexplorer", "subor",
            "calculator", "kalkul", "deskclock", "clock", "hodiny", "weather", "pocasie", "compass", "kompas",
            "scanner", "backup", "updater", "themes", "vending", "browser", "chrome", "firefox", "opera",
            "brave", "vpn", "authenticator", "remote", "bluetooth",
        ),
    )

    fun categorize(app: AppEntry): String {
        if (app.category == ApplicationInfo.CATEGORY_GAME) return "Hry"
        val hay = app.pkg.lowercase() + " " + Apps.norm(app.label)
        rules.firstOrNull { (_, words) -> words.any { hay.contains(it) } }?.let { return it.first }
        return when (app.category) {
            ApplicationInfo.CATEGORY_AUDIO, ApplicationInfo.CATEGORY_VIDEO, ApplicationInfo.CATEGORY_IMAGE -> "Médiá"
            ApplicationInfo.CATEGORY_SOCIAL -> "Sociálne"
            ApplicationInfo.CATEGORY_NEWS -> "Správy"
            ApplicationInfo.CATEGORY_MAPS -> "Cestovanie"
            ApplicationInfo.CATEGORY_PRODUCTIVITY -> "Práca"
            ApplicationInfo.CATEGORY_ACCESSIBILITY -> "Nástroje"
            else -> {
                val pkg = app.pkg
                if (pkg.startsWith("com.miui") || pkg.startsWith("com.xiaomi") || pkg.startsWith("com.android")) {
                    "Nástroje"
                } else {
                    OTHER
                }
            }
        }
    }

    /** Vyprázdni obe plochy a poukladá aplikácie podľa kategórií; obľúbené idú na začiatok ľavej plochy. */
    fun autoSort(board: Board, apps: List<AppEntry>, favoritePackages: List<String>) {
        val groups = (leftPanel + rightPanel).associateWith { mutableListOf<String>() }
        val favorites = favoritePackages.mapNotNull { pkg -> apps.firstOrNull { it.pkg == pkg }?.key }.distinct()
        groups.getValue(FAVORITES).addAll(favorites)
        apps.filter { it.key !in favorites }.forEach { groups.getValue(categorize(it)).add(it.key) }

        listOf(leftPanel, rightPanel).forEachIndexed { i, names ->
            val panel = board.panels[i]
            panel.sections.clear()
            names.forEach { name ->
                val list = groups.getValue(name)
                if (list.isNotEmpty() || name == FAVORITES) {
                    panel.sections.add(Section(name, collapsed = name in startCollapsed, apps = list))
                }
            }
        }
    }
}
