# AutoAHP · Intelligence System

Sistem pendukung keputusan berbasis Analytic Hierarchy Process (AHP) dengan dashboard Auto Intelligence bertema navy–cyan–violet, serta engine perhitungan Python.

## Jaminan perhitungan

- Bobot dihitung di server memakai **principal eigenvector (Saaty)**, bukan JavaScript browser.
- Setiap matriks harus persegi, positif, berada pada skala Saaty `1/9`–`9`, diagonal bernilai `1`, dan resiprokal.
- Hasil menyertakan `lambda_max`, CI, CR, serta residu eigen untuk jejak audit.
- Peringkat dengan matriks ber-CR lebih dari `0.10` tetap dapat diperiksa, tetapi jelas ditandai sebagai perlu ditinjau ulang—bukan keputusan final.

## Jalankan

```powershell
$py = "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
& $py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Jika lokasi Python Anda berbeda, ganti nilai `$py` dengan lokasi `python.exe` Anda. Perintah ini tidak membutuhkan aktivasi virtual environment sehingga menghindari masalah alias `python` Microsoft Store.

Buka `http://127.0.0.1:5000`.

## Uji regresi

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## GitHub Pages

Repositori ini sudah memiliki `index.html` statis, `.nojekyll`, dan workflow `.github/workflows/deploy-pages.yml`. Setelah diunggah ke GitHub:

1. Buat repositori **Public** di GitHub, tanpa menambahkan README dari GitHub.
2. Dari folder proyek, jalankan perintah berikut dan ganti dua placeholdernya. Jika repositori lokal sudah memiliki commit, jangan jalankan `git init` lagi.

   ```powershell
   git add .
   git commit -m "feat: publish AutoAHP Intelligence System"
   git remote add origin https://github.com/USERNAME/NAMA-REPOSITORI.git
   git push -u origin main
   ```

3. Buka **Settings → Pages → Build and deployment → Source**, lalu pilih **GitHub Actions**.
4. Tunggu workflow **Publish AutoAHP Intelligence System to GitHub Pages** selesai. Situs Anda tersedia di `https://USERNAME.github.io/NAMA-REPOSITORI/`.

Setelah pembaruan berikutnya, cukup jalankan `git add .`, `git commit -m "deskripsi perubahan"`, lalu `git push`; Pages akan dipublikasikan ulang otomatis.

GitHub Pages tidak menjalankan Flask/Python. Karena itu, versi Pages menggunakan engine browser lokal yang menerapkan validasi matriks dan principal eigenvector yang sama; tidak ada data penilaian yang dikirim ke server. Untuk penggunaan dengan API Python sebagai engine otoritatif, jalankan Flask atau deploy backend ke layanan Python terpisah.

## Struktur publikasi

- `app.py` dan `ahp_engine.py`: aplikasi Flask dan perhitungan Python untuk penggunaan lokal/server.
- `index.html` dan `static/`: aplikasi statis yang dipublikasikan di GitHub Pages.
- `static/js/ahp_static_engine.js`: fallback lokal untuk Pages; telah diuji setara dengan output engine Python pada kasus regresi.
- `.github/workflows/deploy-pages.yml`: workflow yang menerbitkan hanya berkas situs statis.
