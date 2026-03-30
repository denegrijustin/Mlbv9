# MLB Dashboard

Stable multi-file Streamlit app built for simple GitHub upload and Streamlit Cloud deployment.

## Files you should upload
- app.py
- mlb_api.py
- data_helpers.py
- charts.py
- formatting.py
- requirements.txt
- README.md

## Folder setup
Put all files in the root of your GitHub repo.
Do not use subfolders.
Do not upload __pycache__.

## Deploy on Streamlit
1. Upload all files to GitHub.
2. Open Streamlit Community Cloud.
3. Choose your repo.
4. Set main file path to app.py.
5. Deploy.

## Local run
```bash
pip install -r requirements.txt
streamlit run app.py
```

## Notes
This version prioritizes stability first.
It loads team and schedule data safely and handles missing live-game feeds gracefully.
