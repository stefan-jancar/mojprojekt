package sk.mojpriestor.plocha

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

const val MODE_SPLIT = 0 // obe plochy vedľa seba
const val MODE_LEFT = 1  // len ľavá plocha
const val MODE_RIGHT = 2 // len pravá plocha

/** Sekcia (priečinok) s aplikáciami v poradí, ktoré si určíš. Aplikácia je kľúč „balík/aktivita“. */
class Section(
    var name: String,
    var collapsed: Boolean = false,
    val apps: MutableList<String> = mutableListOf(),
)

class Panel(var name: String, val sections: MutableList<Section> = mutableListOf())

/** Celé usporiadanie plochy – ukladá sa ako JSON do SharedPreferences. */
class Board {
    val panels = mutableListOf(Panel("Plocha 1"), Panel("Plocha 2"))
    var mode = MODE_SPLIT
    var active = 0
    var minimized = false
    var colsSplit = 3
    var colsSingle = 5
    var wallpaper = true
    var initialized = false
    /** aplikácie, ktoré už plocha videla – nové sa zaradia do sekcie „Nové“ */
    val known = mutableSetOf<String>()

    fun save(prefs: SharedPreferences) {
        prefs.edit().putString(KEY, toJson().toString()).apply()
    }

    private fun toJson(): JSONObject = JSONObject().apply {
        put("mode", mode)
        put("active", active)
        put("minimized", minimized)
        put("colsSplit", colsSplit)
        put("colsSingle", colsSingle)
        put("wallpaper", wallpaper)
        put("initialized", initialized)
        put("known", JSONArray(known.toList()))
        put("panels", JSONArray().apply {
            panels.forEach { p ->
                put(JSONObject().apply {
                    put("name", p.name)
                    put("sections", JSONArray().apply {
                        p.sections.forEach { s ->
                            put(JSONObject().apply {
                                put("name", s.name)
                                put("collapsed", s.collapsed)
                                put("apps", JSONArray(s.apps))
                            })
                        }
                    })
                })
            }
        })
    }

    companion object {
        private const val KEY = "board"

        fun load(prefs: SharedPreferences): Board {
            val raw = prefs.getString(KEY, null) ?: return Board()
            return try {
                val o = JSONObject(raw)
                Board().apply {
                    mode = o.optInt("mode", MODE_SPLIT)
                    active = o.optInt("active", 0).coerceIn(0, 1)
                    minimized = o.optBoolean("minimized", false)
                    colsSplit = o.optInt("colsSplit", 3)
                    colsSingle = o.optInt("colsSingle", 5)
                    wallpaper = o.optBoolean("wallpaper", true)
                    initialized = o.optBoolean("initialized", false)
                    o.optJSONArray("known")?.let { a -> for (i in 0 until a.length()) known.add(a.getString(i)) }
                    val ps = o.optJSONArray("panels")
                    if (ps != null) {
                        for (i in 0 until minOf(ps.length(), 2)) {
                            val po = ps.getJSONObject(i)
                            val panel = panels[i]
                            panel.name = po.optString("name", panel.name)
                            val ss = po.optJSONArray("sections") ?: continue
                            for (j in 0 until ss.length()) {
                                val so = ss.getJSONObject(j)
                                val section = Section(so.optString("name", "Sekcia"), so.optBoolean("collapsed", false))
                                so.optJSONArray("apps")?.let { a -> for (k in 0 until a.length()) section.apps.add(a.getString(k)) }
                                panel.sections.add(section)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Board()
            }
        }
    }
}
