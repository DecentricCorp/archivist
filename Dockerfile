FROM node
WORKDIR ./src/
RUN npm install -g https://github.com/DecentricCorp/archivist.git
CMD ["archivist"]
