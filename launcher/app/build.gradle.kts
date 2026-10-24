import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// číslo verzie dodáva GitHub Actions (-PversionCode=<číslo behu>)
val buildNumber = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "sk.mojpriestor.plocha"
    compileSdk = 36

    defaultConfig {
        applicationId = "sk.mojpriestor.plocha"
        minSdk = 26
        targetSdk = 36
        versionCode = buildNumber
        versionName = buildNumber.toString()
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
