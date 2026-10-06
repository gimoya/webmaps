#push to master


git add -A
git status
git commit -m 'batch updates from shell script..'
echo -e "\n---\n"  
read -p "Hit [Enter] to continue..."
git push origin master
echo -e "\n---\n"
read -p "Hit [Enter] to exit..."